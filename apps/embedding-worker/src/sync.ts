import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { notes, embeddings } from "@zk/db-schema";
import type { MLClient } from "./ml-client.js";

const BATCH_SIZE = 32;

export interface SyncResult {
  embedded: number;
}

/**
 * Query notes that need (re-)embedding:
 *   - notes with no embedding row, OR
 *   - notes where note.updated_at > embedding.generated_at
 */
async function fetchPendingNotes(
  db: ReturnType<typeof drizzle>,
  limit: number
): Promise<{ id: string; title: string; bodyMd: string | null }[]> {
  const rows = await db.execute<{ id: string; title: string; body_md: string | null }>(
    sql`
      SELECT n.id, n.title, n.body_md
      FROM note n
      LEFT JOIN embedding e ON e.note_id = n.id
      WHERE e.note_id IS NULL
         OR e.generated_at < n.updated_at
      LIMIT ${limit}
    `
  );
  return rows.map((r) => ({ id: r.id, title: r.title, bodyMd: r.body_md }));
}

/**
 * Core sync function. Pure logic — takes db and mlClient as arguments.
 * Returns the count of embeddings written.
 */
export async function runSync(
  db: ReturnType<typeof drizzle>,
  mlClient: MLClient
): Promise<SyncResult> {
  let totalEmbedded = 0;

  let batch = await fetchPendingNotes(db, BATCH_SIZE);

  while (batch.length > 0) {
    const texts = batch.map((n) => n.bodyMd ?? n.title);

    const { vectors, modelVersion } = await mlClient.embed(texts);

    // Write embeddings via UPSERT
    for (let i = 0; i < batch.length; i++) {
      const noteRow = batch[i]!;
      const vector = vectors[i]!;

      await db.execute(
        sql`
          INSERT INTO embedding (note_id, vector, model_version, generated_at)
          VALUES (
            ${noteRow.id}::uuid,
            ${`[${vector.join(",")}]`}::vector,
            ${modelVersion},
            NOW()
          )
          ON CONFLICT (note_id) DO UPDATE
            SET vector = EXCLUDED.vector,
                model_version = EXCLUDED.model_version,
                generated_at = EXCLUDED.generated_at
        `
      );
      totalEmbedded++;
    }

    // Fetch next batch (already-embedded notes won't appear again)
    batch = await fetchPendingNotes(db, BATCH_SIZE);
  }

  return { embedded: totalEmbedded };
}
