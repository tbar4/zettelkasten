import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { zodErrorHook } from "../lib/zod-error-hook";
import { httpMlClient, type MLClient } from "../lib/ml-client";
import { computeFeatures, featuresToVector } from "../lib/reranker-features";

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

/** Cold-start gate: return true if we have >= 30 feedback rows */
async function hasSufficientFeedback(): Promise<boolean> {
  const rows = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM suggestion_feedback`
  );
  return Number(rows[0]?.count ?? "0") >= 30;
}

/**
 * Re-rank results using the ML service. Returns the re-ordered list.
 * Falls back to original order on any error.
 */
async function tryRerank(
  results: NoteRow[],
  fromNoteId: string | null
): Promise<{ results: NoteRow[]; usingReranker: boolean }> {
  try {
    const sufficient = await hasSufficientFeedback();
    if (!sufficient) {
      return { results, usingReranker: false };
    }

    // Compute feature vectors for all candidates in parallel
    const featureVectors = await Promise.all(
      results.map((r) =>
        computeFeatures(fromNoteId, r.id)
          .then(featuresToVector)
          .catch(() => [0, 0, 0, 0, 0] as number[])
      )
    );

    const mlClient = getMlClient();
    const { scores } = await mlClient.rerank(featureVectors);

    // Zip results with scores and sort descending by re-rank score
    const ranked = results
      .map((r, i) => ({ r, score: scores[i] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .map(({ r }) => r);

    return { results: ranked, usingReranker: true };
  } catch {
    // Fall back to original embedding order on any error
    return { results, usingReranker: false };
  }
}

/**
 * GET /api/search/semantic?q=...&limit=10
 *
 * Embeds the query via ML service, then runs cosine-distance query against
 * the embedding table. Returns notes ordered by similarity descending.
 * If >= 30 feedback events exist, results are re-ranked by the personal MLP.
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

    const initial: NoteRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      similarity: Number(r.similarity)
    }));

    // fromNoteId is null for free-text semantic search — skip re-rank
    const { results, usingReranker } = await tryRerank(initial, null);

    return c.json({ results, usingReranker });
  }
);

/**
 * GET /api/notes/:id/related?limit=8
 *
 * Fetches the note's stored embedding, then finds the top-K most similar notes
 * (excluding the note itself). Returns `reason: "no-embedding"` if the source
 * note has no embedding row. If >= 30 feedback events exist, re-ranks with MLP.
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

    const initial: NoteRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      similarity: Number(r.similarity)
    }));

    const { results, usingReranker } = await tryRerank(initial, id);

    return c.json({ results, usingReranker });
  }
);
