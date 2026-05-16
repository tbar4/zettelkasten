import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { httpMlClient, type MLClient } from "../lib/ml-client";
import { computeFeatures, featuresToVector } from "../lib/reranker-features";

export const mlRoute = new Hono();

// Allow injection of a custom ML client (for testing)
let _mlClient: MLClient | null = null;
export function setMlClientForMl(client: MLClient | null): void {
  _mlClient = client;
}
function getMlClient(): MLClient {
  if (_mlClient) return _mlClient;
  const baseUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  return httpMlClient(baseUrl);
}

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

/**
 * POST /api/ml/retrain-reranker
 *
 * Manual trigger to retrain the re-ranker model.
 * Fetches all suggestion_feedback rows, computes 5-dim feature vectors for
 * each pair, then sends them to the ML service for one training step.
 *
 * Returns:
 *   { trained: N, status: "ok" | "ml-unavailable" }
 */
mlRoute.post("/retrain-reranker", async (c) => {
  // Fetch all feedback rows
  const feedbackRows = await db.execute<{
    from_note_id: string | null;
    to_note_id: string;
    action: string;
  }>(sql`
    SELECT from_note_id::text, to_note_id::text, action
    FROM suggestion_feedback
  `);

  if (feedbackRows.length === 0) {
    return c.json({ trained: 0, status: "ok" });
  }

  // Compute features for every feedback row (in parallel, batched)
  const featureResults = await Promise.all(
    feedbackRows.map((row) =>
      computeFeatures(row.from_note_id, row.to_note_id).catch(() => null)
    )
  );

  const features: number[][] = [];
  const labels: number[] = [];

  feedbackRows.forEach((row, i) => {
    const feats = featureResults[i];
    if (!feats) return; // skip rows where feature computation failed
    features.push(featuresToVector(feats));
    labels.push(row.action === "accepted" ? 1 : 0);
  });

  if (features.length === 0) {
    return c.json({ trained: 0, status: "ok" });
  }

  try {
    const mlClient = getMlClient();
    await mlClient.trainReranker(features, labels);
    return c.json({ trained: features.length, status: "ok" });
  } catch {
    return c.json({ trained: 0, status: "ml-unavailable" });
  }
});
