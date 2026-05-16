import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import type { NotionClient } from "../src/notion/client";
import { buildPreview, commitImport } from "../src/notion/import";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

function makeFakeClient(pages: {
  id: string;
  title: string;
  properties?: Record<string, unknown>;
  blocks: { type: string; [key: string]: unknown }[];
}[]): NotionClient {
  return {
    async listDatabasePages() {
      return pages.map((p) => ({
        id: p.id,
        properties: {
          ...(p.properties ?? {}),
          Name: { type: "title", title: [{ plain_text: p.title }] }
        }
      }));
    },
    async listBlockChildren(pageId: string) {
      const page = pages.find((p) => p.id === pageId);
      return page ? page.blocks : [];
    }
  };
}

describe("buildPreview", () => {
  it("returns a row per Notion page with detected type and body", async () => {
    const client = makeFakeClient([
      {
        id: "abc-1234",
        title: "A Page",
        blocks: [
          { type: "paragraph", paragraph: { rich_text: [{ plain_text: "body text" }] } }
        ]
      }
    ]);
    const preview = await buildPreview(client, "db-id");
    expect(preview.pages).toHaveLength(1);
    expect(preview.pages[0]!.notionPageId).toBe("abc-1234");
    expect(preview.pages[0]!.title).toBe("A Page");
    expect(preview.pages[0]!.detectedType).toBe("fleeting");
    expect(preview.pages[0]!.body).toContain("body text");
  });

  it("counts inbound mentions for typing", async () => {
    const client = makeFakeClient([
      { id: "topic-page", title: "Topic", blocks: [] },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `linker-${i}`,
        title: `Linker ${i}`,
        blocks: [
          {
            type: "paragraph",
            paragraph: {
              rich_text: [
                { plain_text: "see " },
                {
                  type: "mention",
                  mention: { type: "page", page: { id: "topic-page" } },
                  plain_text: "Topic"
                }
              ]
            }
          }
        ]
      }))
    ]);
    const preview = await buildPreview(client, "db-id");
    const topic = preview.pages.find((p) => p.notionPageId === "topic-page");
    expect(topic?.detectedType).toBe("topic");
  });
});

async function clearDb() {
  await db.execute(
    rawSql`TRUNCATE TABLE note_source, highlight, source, spaced_review, note_tag, note_link, tag, note RESTART IDENTITY CASCADE`
  );
}

describe("commitImport", () => {
  it("inserts notes idempotently keyed by notion_page_id", async () => {
    await clearDb();
    const pages = [
      {
        notionPageId: "abc-1234",
        title: "A Page",
        body: "hello",
        type: "permanent" as const
      }
    ];

    const r1 = await commitImport(db, pages);
    expect(r1.inserted).toBe(1);
    expect(r1.updated).toBe(0);

    const r2 = await commitImport(db, pages);
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(1);

    const rows = await db.select().from(schema.notes);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.notionPageId).toBe("abc-1234");
    expect(rows[0]!.type).toBe("permanent");
  });

  it("rewrites notion mentions to [[Title]] using the import set", async () => {
    await clearDb();
    const pages = [
      {
        notionPageId: "target-id",
        title: "Target Page",
        body: "I am the target.",
        type: "permanent" as const
      },
      {
        notionPageId: "source-id",
        title: "Source Page",
        body: "See [[notion:page:target-id|Target Page]] for more.",
        type: "permanent" as const
      }
    ];
    await commitImport(db, pages);
    const rows = await db.select().from(schema.notes);
    const source = rows.find((r) => r.notionPageId === "source-id");
    expect(source?.bodyMd).toBe("See [[Target Page]] for more.");
  });

  it("falls back to the embedded label when a mention target isn't in the import set", async () => {
    await clearDb();
    const pages = [
      {
        notionPageId: "orphan-source",
        title: "Source",
        body: "See [[notion:page:unknown-id|Fallback Label]] for more.",
        type: "permanent" as const
      }
    ];
    await commitImport(db, pages);
    const rows = await db.select().from(schema.notes);
    expect(rows[0]!.bodyMd).toBe("See [[Fallback Label]] for more.");
  });
});
