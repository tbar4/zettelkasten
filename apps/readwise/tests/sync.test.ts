import { describe, it, expect, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { runSync } from "../src/sync";
import type { ReadwiseBook } from "../src/client";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test_readwise";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

beforeEach(async () => {
  await db.execute(
    rawSql`TRUNCATE TABLE note_source, highlight, source, spaced_review, note_tag, note_link, tag, note RESTART IDENTITY CASCADE`
  );
});

afterAll(async () => {
  await client.end();
});

function makeFakeClient(pages: { books: ReadwiseBook[]; nextPageCursor: string | null }[]) {
  let i = 0;
  return {
    async exportHighlights() {
      const p = pages[i] ?? { books: [], nextPageCursor: null };
      i++;
      return p;
    }
  };
}

const sampleBook: ReadwiseBook = {
  user_book_id: 12345,
  title: "Foucault",
  author: "Michel Foucault",
  category: "books",
  source_url: null,
  asin: null,
  highlights: [
    {
      id: 1,
      text: "First highlight",
      note: null,
      location: 10,
      location_type: "order",
      highlighted_at: "2026-05-15T10:00:00Z",
      color: "yellow"
    },
    {
      id: 2,
      text: "Second highlight",
      note: "with note",
      location: 20,
      location_type: "order",
      highlighted_at: "2026-05-15T11:00:00Z",
      color: "blue"
    }
  ]
};

describe("runSync", () => {
  it("upserts source by readwise_book_id and inserts new highlights", async () => {
    const fakeClient = makeFakeClient([{ books: [sampleBook], nextPageCursor: null }]);
    const result = await runSync(url, fakeClient);
    expect(result.sourcesUpserted).toBe(1);
    expect(result.highlightsInserted).toBe(2);

    const sourceRows = await db.select().from(schema.sources);
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]!.title).toBe("Foucault");
    expect(sourceRows[0]!.readwiseBookId).toBe("12345");

    const highlightRows = await db.select().from(schema.highlights);
    expect(highlightRows).toHaveLength(2);
    expect(highlightRows.map((h) => h.text).sort()).toEqual([
      "First highlight",
      "Second highlight"
    ]);
  });

  it("is idempotent on a second run with the same data", async () => {
    const client1 = makeFakeClient([{ books: [sampleBook], nextPageCursor: null }]);
    await runSync(url, client1);
    const client2 = makeFakeClient([{ books: [sampleBook], nextPageCursor: null }]);
    const result = await runSync(url, client2);
    expect(result.highlightsInserted).toBe(0);

    const sourceRows = await db.select().from(schema.sources);
    expect(sourceRows).toHaveLength(1);
    const highlightRows = await db.select().from(schema.highlights);
    expect(highlightRows).toHaveLength(2);
  });

  it("updates highlight text on re-sync when the source data changed", async () => {
    const bookV1 = {
      ...sampleBook,
      highlights: [
        {
          id: 1,
          text: "old text",
          note: null,
          location: 10,
          location_type: "order",
          highlighted_at: "2026-05-15T10:00:00Z",
          color: "yellow"
        }
      ]
    };
    const bookV2 = {
      ...sampleBook,
      highlights: [
        {
          id: 1,
          text: "edited text",
          note: "now with a note",
          location: 10,
          location_type: "order",
          highlighted_at: "2026-05-15T10:00:00Z",
          color: "blue"
        }
      ]
    };

    await runSync(url, makeFakeClient([{ books: [bookV1], nextPageCursor: null }]));
    await runSync(url, makeFakeClient([{ books: [bookV2], nextPageCursor: null }]));

    const rows = await db.select().from(schema.highlights);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("edited text");
    expect(rows[0]!.noteText).toBe("now with a note");
    expect(rows[0]!.color).toBe("blue");
  });

  it("paginates across pages", async () => {
    const fakeClient = makeFakeClient([
      { books: [sampleBook], nextPageCursor: "next" },
      {
        books: [
          {
            ...sampleBook,
            user_book_id: 99999,
            title: "Another Book",
            highlights: [
              {
                id: 99,
                text: "Other highlight",
                note: null,
                location: 1,
                location_type: "order",
                highlighted_at: null,
                color: null
              }
            ]
          }
        ],
        nextPageCursor: null
      }
    ]);
    const result = await runSync(url, fakeClient);
    expect(result.sourcesUpserted).toBe(2);
    expect(result.highlightsInserted).toBe(3);
  });
});
