import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { zodErrorHook } from "../lib/zod-error-hook";
import { httpMlClient, type MLClient } from "../lib/ml-client";

// Allow injection of a custom ML client (for testing)
let _mlClient: MLClient | null = null;

export function setMlClient(client: MLClient | null): void {
  _mlClient = client;
}

function getMlClient(): MLClient {
  if (_mlClient) return _mlClient;
  const baseUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  return httpMlClient(baseUrl);
}

export const searchRoute = new Hono();

const SemanticQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10)
});

const RelatedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8)
});

const idParam = z.object({ id: z.string().uuid() });

interface NoteRow {
  id: string;
  title: string;
  type: string;
  similarity: number;
}

/**
 * GET /api/search/semantic?q=...&limit=10
 *
 * Embeds the query via ML service, then runs cosine-distance query against
 * the embedding table. Returns notes ordered by similarity descending.
 */
searchRoute.get(
  "/semantic",
  zValidator("query", SemanticQuerySchema, zodErrorHook),
  async (c) => {
    const { q, limit } = c.req.valid("query");

    let queryVector: number[];
    try {
      const mlClient = getMlClient();
      const { vectors } = await mlClient.embed([q]);
      queryVector = vectors[0]!;
    } catch {
      return c.json({ results: [], reason: "ml-unavailable" });
    }

    const vecLiteral = `[${queryVector.join(",")}]`;

    const rows = await db.transaction(async (tx) => {
      // Set high probes to ensure exact scan with small datasets (IVFFlat)
      await tx.execute(sql`SET LOCAL ivfflat.probes = 100`);
      return tx.execute<{
        id: string;
        title: string;
        type: string;
        similarity: number;
      }>(sql`
        SELECT n.id, n.title, n.type,
               1 - (e.vector <=> ${vecLiteral}::vector) AS similarity
        FROM embedding e
        JOIN note n ON n.id = e.note_id
        WHERE n.archived_at IS NULL
        ORDER BY e.vector <=> ${vecLiteral}::vector
        LIMIT ${limit}
      `);
    });

    const results: NoteRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      similarity: Number(r.similarity)
    }));

    return c.json({ results });
  }
);

/**
 * GET /api/notes/:id/related?limit=8
 *
 * Fetches the note's stored embedding, then finds the top-K most similar notes
 * (excluding the note itself). Returns `reason: "no-embedding"` if the source
 * note has no embedding row.
 */
searchRoute.get(
  "/:id/related",
  zValidator("param", idParam, zodErrorHook),
  zValidator("query", RelatedQuerySchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const { limit } = c.req.valid("query");

    // Fetch the source note's embedding vector
    const [embRow] = await db.execute<{ vector: string }>(sql`
      SELECT vector::text FROM embedding WHERE note_id = ${id}::uuid
    `);

    if (!embRow) {
      return c.json({ results: [], reason: "no-embedding" });
    }

    const vecLiteral = embRow.vector;

    const rows = await db.transaction(async (tx) => {
      // Set high probes to ensure exact scan with small datasets (IVFFlat)
      await tx.execute(sql`SET LOCAL ivfflat.probes = 100`);
      return tx.execute<{
        id: string;
        title: string;
        type: string;
        similarity: number;
      }>(sql`
        SELECT n.id, n.title, n.type,
               1 - (e.vector <=> ${vecLiteral}::vector) AS similarity
        FROM embedding e
        JOIN note n ON n.id = e.note_id
        WHERE n.archived_at IS NULL
          AND n.id <> ${id}::uuid
        ORDER BY e.vector <=> ${vecLiteral}::vector
        LIMIT ${limit}
      `);
    });

    const results: NoteRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      similarity: Number(r.similarity)
    }));

    return c.json({ results });
  }
);
