import { eq } from "drizzle-orm";
import { notes } from "@zk/db-schema";
import type { NotionClient, NotionPage } from "./client";
import { blocksToMarkdown } from "./blocks-to-markdown";
import { detectType, type NoteType } from "./typer";
import { extractMentionIds, rewriteMentions } from "./mentions";
import { syncWikilinks } from "../lib/wikilinks-sync";

export interface PreviewPage {
  notionPageId: string;
  title: string;
  body: string;
  detectedType: NoteType;
}

export interface Preview {
  pages: PreviewPage[];
}

function readTitle(page: NotionPage): string {
  const properties = (page?.properties ?? {}) as Record<
    string,
    {
      type?: string;
      title?: { plain_text?: string }[];
      rich_text?: { plain_text?: string }[];
    }
  >;
  for (const key of Object.keys(properties)) {
    const p = properties[key]!;
    if (p.type === "title" && p.title?.length) {
      return p.title.map((t) => t.plain_text ?? "").join("").trim() || "Untitled";
    }
  }
  return "Untitled";
}

export async function buildPreview(
  client: NotionClient,
  databaseId: string
): Promise<Preview> {
  const pages = await client.listDatabasePages(databaseId);

  const intermediate: {
    page: NotionPage;
    title: string;
    body: string;
    mentionIds: string[];
  }[] = [];
  for (const p of pages) {
    const blocks = await client.listBlockChildren(p.id);
    const body = blocksToMarkdown(blocks);
    intermediate.push({
      page: p,
      title: readTitle(p),
      body,
      mentionIds: extractMentionIds(body)
    });
  }

  const inbound = new Map<string, number>();
  for (const i of intermediate) {
    for (const id of i.mentionIds) {
      inbound.set(id, (inbound.get(id) ?? 0) + 1);
    }
  }

  const previewPages: PreviewPage[] = intermediate.map((i) => ({
    notionPageId: (i.page as { id: string }).id,
    title: i.title,
    body: i.body,
    detectedType: detectType(i.page, {
      inboundMentions: inbound.get((i.page as { id: string }).id) ?? 0,
      bodyLength: i.body.length
    })
  }));

  return { pages: previewPages };
}

export interface CommitInputPage {
  notionPageId: string;
  title: string;
  body: string;
  type: NoteType;
}

export interface CommitResult {
  inserted: number;
  updated: number;
}

export async function commitImport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  pages: CommitInputPage[]
): Promise<CommitResult> {
  const titleByPageId = new Map<string, string>();
  for (const p of pages) titleByPageId.set(p.notionPageId, p.title);

  let inserted = 0;
  let updated = 0;

  await db.transaction(async (tx: typeof db) => {
    const upserted: { id: string; bodyMd: string | null }[] = [];

    for (const p of pages) {
      const rewrittenBody = rewriteMentions(p.body, titleByPageId);
      const bodyMd = p.type === "topic" ? null : rewrittenBody;

      const [existing] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(eq(notes.notionPageId, p.notionPageId));

      if (existing) {
        await tx
          .update(notes)
          .set({
            title: p.title,
            type: p.type,
            bodyMd,
            updatedAt: new Date()
          })
          .where(eq(notes.id, existing.id));
        updated++;
        upserted.push({ id: existing.id as string, bodyMd });
      } else {
        const [row] = await tx
          .insert(notes)
          .values({
            type: p.type,
            title: p.title,
            bodyMd,
            notionPageId: p.notionPageId
          })
          .returning({ id: notes.id });
        inserted++;
        upserted.push({ id: (row as { id: string }).id, bodyMd });
      }
    }

    for (const u of upserted) {
      await syncWikilinks(tx, u.id, u.bodyMd);
    }
  });

  return { inserted, updated };
}
