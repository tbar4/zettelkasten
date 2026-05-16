import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

export const mlRoute = new Hono();

interface EmbeddingStatusResult {
  total: number;
  embedded: number;
  stale: number;
}

/**
 * GET /api/ml/embedding-status
 *
 * Returns:
 *   total    — total non-archived notes
 *   embedded — notes with an up-to-date embedding (generated_at >= updated_at)
 *   stale    — notes with a stale or missing embedding
 */
mlRoute.get("/embedding-status", async (c) => {
  const [row] = await db.execute<{
    total: string;
    embedded: string;
    stale: string;
  }>(sql`
    SELECT
      COUNT(*) AS total,
      COUNT(e.note_id) FILTER (WHERE e.generated_at >= n.updated_at) AS embedded,
      COUNT(*) FILTER (
        WHERE e.note_id IS NULL OR e.generated_at < n.updated_at
      ) AS stale
    FROM note n
    LEFT JOIN embedding e ON e.note_id = n.id
    WHERE n.archived_at IS NULL
  `);

  const result: EmbeddingStatusResult = {
    total: Number(row!.total),
    embedded: Number(row!.embedded),
    stale: Number(row!.stale)
  };

  return c.json(result);
});
