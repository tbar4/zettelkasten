import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { sources, highlights } from "@zk/db-schema";
import type { ReadwiseClient, ReadwiseBook } from "./client";

export interface SyncResult {
  sourcesUpserted: number;
  highlightsInserted: number;
}

export async function runSync(
  databaseUrl: string,
  client: ReadwiseClient
): Promise<SyncResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(sql, { schema: { sources, highlights } });

    let sourcesUpserted = 0;
    let highlightsInserted = 0;
    let cursor: string | undefined = undefined;

    do {
      const page = await client.exportHighlights({ pageCursor: cursor });
      for (const book of page.books) {
        const sourceId = await upsertSource(db, book);
        sourcesUpserted++;
        highlightsInserted += await insertHighlights(db, sourceId, book);
      }
      cursor = page.nextPageCursor ?? undefined;
    } while (cursor);

    return { sourcesUpserted, highlightsInserted };
  } finally {
    await sql.end();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertSource(db: any, book: ReadwiseBook): Promise<string> {
  const readwiseBookId = String(book.user_book_id);
  const [existing] = await db
    .select()
    .from(sources)
    .where(eq(sources.readwiseBookId, readwiseBookId));
  if (existing) {
    await db
      .update(sources)
      .set({
        title: book.title,
        author: book.author ?? null,
        sourceType: book.category ?? null,
        url: book.source_url ?? null,
        isbn: book.asin ?? null,
        updatedAt: new Date()
      })
      .where(eq(sources.id, existing.id));
    return existing.id as string;
  }
  const [inserted] = await db
    .insert(sources)
    .values({
      title: book.title,
      author: book.author ?? null,
      sourceType: book.category ?? null,
      url: book.source_url ?? null,
      isbn: book.asin ?? null,
      readwiseBookId
    })
    .returning({ id: sources.id });
  return (inserted as { id: string }).id;
}

async function insertHighlights(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sourceId: string,
  book: ReadwiseBook
): Promise<number> {
  let inserted = 0;
  for (const h of book.highlights) {
    const readwiseHighlightId = String(h.id);
    const result = await db
      .insert(highlights)
      .values({
        sourceId,
        text: h.text,
        noteText: h.note ?? null,
        location:
          h.location !== undefined && h.location !== null
            ? String(h.location)
            : null,
        color: h.color ?? null,
        readwiseHighlightId
      })
      // Untargeted: the partial unique index on readwise_highlight_id
      // (WHERE NOT NULL) can't be addressed via Drizzle's target shorthand
      // in 0.36. The PK is gen_random_uuid() so the only conflict surface
      // is that partial unique — re-syncs of the same highlight no-op.
      .onConflictDoNothing()
      .returning({ id: highlights.id });
    if (result.length > 0) inserted++;
  }
  return inserted;
}
