import { Hono } from "hono";
import { and, asc, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notes, spacedReview, sources, highlights, embeddings } from "@zk/db-schema";
import { httpMlClient, type MLClient } from "../lib/ml-client";

export const inboxRoute = new Hono();

// Allow injection of a custom ML client (for testing)
let _mlClient: MLClient | null = null;
export function setMlClientForInbox(client: MLClient | null): void {
  _mlClient = client;
}
function getMlClient(): MLClient {
  if (_mlClient) return _mlClient;
  const baseUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  return httpMlClient(baseUrl);
}

/**
 * Extract a 5-dim feature vector for a highlight.
 *
 * Features:
 *   0. text_length_norm       — min(len(text) / 500, 1.0)
 *   1. has_note               — 1.0 if note_text is non-empty
 *   2. color_score            — yellow=0.3, blue=0.5, pink=0.7, green=0.9, null=0.1
 *   3. source_type_score      — book=0.7, article=0.5, other=0.3
 *   4. hour_of_day_normalized — created_at hour / 24
 */
const COLOR_SCORES: Record<string, number> = {
  yellow: 0.3,
  blue: 0.5,
  pink: 0.7,
  green: 0.9
};

const SOURCE_TYPE_SCORES: Record<string, number> = {
  book: 0.7,
  article: 0.5
};

function extractFeatures(
  h: {
    text: string;
    note_text: string | null;
    color: string | null;
    source_type: string | null;
    created_at: Date;
  }
): number[] {
  const textLengthNorm = Math.min(h.text.length / 500, 1.0);
  const hasNote = h.note_text && h.note_text.length > 0 ? 1.0 : 0.0;
  const colorScore = h.color ? (COLOR_SCORES[h.color] ?? 0.1) : 0.1;
  const sourceTypeScore = h.source_type
    ? (SOURCE_TYPE_SCORES[h.source_type] ?? 0.3)
    : 0.3;
  const hourNorm = h.created_at.getUTCHours() / 24;
  return [textLengthNorm, hasNote, colorScore, sourceTypeScore, hourNorm];
}

inboxRoute.get("/", async (c) => {
  const dueRows = await db
    .select({
      id: notes.id,
      title: notes.title,
      type: notes.type,
      next_due_at: spacedReview.nextDueAt
    })
    .from(spacedReview)
    .innerJoin(notes, eq(notes.id, spacedReview.noteId))
    .where(
      and(
        lte(spacedReview.nextDueAt, sql`now()`),
        isNull(notes.archivedAt),
        eq(notes.type, "permanent")
      )
    )
    .orderBy(asc(spacedReview.nextDueAt))
    .limit(20);

  const fleetingRows = await db
    .select({ id: notes.id, title: notes.title, type: notes.type })
    .from(notes)
    .where(and(eq(notes.type, "fleeting"), isNull(notes.archivedAt)))
    .orderBy(desc(notes.createdAt))
    .limit(50);

  const highlightRows = await db
    .select({
      id: highlights.id,
      text: highlights.text,
      note_text: highlights.noteText,
      color: highlights.color,
      created_at: highlights.createdAt,
      source_title: sources.title,
      source_id: sources.id,
      source_type: sources.sourceType
    })
    .from(highlights)
    .innerJoin(sources, eq(sources.id, highlights.sourceId))
    .where(
      and(
        isNull(highlights.promotedToNoteId),
        isNull(highlights.dismissedAt)
      )
    )
    .orderBy(desc(highlights.createdAt))
    .limit(50);

  // Score highlights via ML service (graceful fallback to null on error)
  let promotionScores: (number | null)[] = highlightRows.map(() => null);
  if (highlightRows.length > 0) {
    try {
      const mlClient = getMlClient();
      const featureVectors = highlightRows.map((h) =>
        extractFeatures({
          text: h.text,
          note_text: h.note_text,
          color: h.color,
          source_type: h.source_type,
          created_at: h.created_at
        })
      );
      const { scores } = await mlClient.scoreHighlights(featureVectors);
      promotionScores = scores.map((s) => s);
    } catch {
      // ML service unavailable — fall back to null scores (no chip shown)
    }
  }

  // Sort highlights by promotion score DESC when scores are available
  const scoredHighlights = highlightRows.map((h, i) => ({
    ...h,
    promotion_score: promotionScores[i] ?? null
  }));
  // Only sort if we have real scores (not all null / all 0.5 fallback)
  const hasScores = promotionScores.some((s) => s !== null);
  if (hasScores) {
    scoredHighlights.sort((a, b) => {
      const sa = a.promotion_score ?? 0;
      const sb = b.promotion_score ?? 0;
      return sb - sa;
    });
  }

  return c.json({
    due: dueRows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      next_due_at: r.next_due_at.toISOString()
    })),
    fleeting: fleetingRows,
    highlights: scoredHighlights.map((h) => ({
      id: h.id,
      text: h.text,
      source_title: h.source_title,
      source_id: h.source_id,
      promotion_score: h.promotion_score
    }))
  });
});

// ---------------------------------------------------------------------------
// GET /api/inbox/review — ML-driven daily review ranking
// ---------------------------------------------------------------------------
//
// Replaces the simple time-decay from M1 Plan 4 with a hybrid score:
//   score = 0.5 * base_time_decay + 0.3 * embedding_distance + 0.2 * reranker_score
//
// Simplification: reranker_score is omitted here. The reranker is trained on
// related-note suggestions, not on which notes to review, so its signal is weak
// for this endpoint. The two-signal hybrid (time_decay + embedding_distance)
// already captures recency and semantic relevance. Reranker can be layered on
// post-M3 once review-specific feedback is collected.
//
// base_time_decay = 1 - exp(-days_since_last_seen / 14)
// embedding_distance = cosine distance from note's embedding to centroid of
//   notes updated in the last 7 days. Lower distance → more relevant → higher
//   contribution. Score contribution = 1 - distance.
//   Default = 0.5 when no embeddings are available (cold start).

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 1; // max distance
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function averageVectors(vecs: number[][]): number[] | null {
  if (vecs.length === 0) return null;
  const dim = vecs[0]!.length;
  const avg = new Array<number>(dim).fill(0);
  for (const v of vecs) {
    for (let i = 0; i < dim; i++) {
      avg[i]! += v[i]!;
    }
  }
  for (let i = 0; i < dim; i++) {
    avg[i]! /= vecs.length;
  }
  return avg;
}

inboxRoute.get("/review", async (c) => {
  // 1. Candidate set: permanent notes with spaced_review.next_due_at <= now OR no row
  const candidates = await db.execute<{
    id: string;
    title: string;
    type: string;
    last_seen_at: Date | null;
    next_due_at: Date | null;
  }>(sql`
    SELECT
      n.id,
      n.title,
      n.type,
      sr.last_seen_at,
      sr.next_due_at
    FROM note n
    LEFT JOIN spaced_review sr ON sr.note_id = n.id
    WHERE n.type = 'permanent'
      AND n.archived_at IS NULL
      AND (sr.next_due_at IS NULL OR sr.next_due_at <= now())
    LIMIT 100
  `);

  if (candidates.length === 0) {
    return c.json({ review: [] });
  }

  // 2. Fetch centroid of recently-edited notes' embeddings (last 7 days)
  const recentEmbeddings = await db.execute<{ vector: string }>(sql`
    SELECT e.vector::text
    FROM embedding e
    INNER JOIN note n ON n.id = e.note_id
    WHERE n.updated_at > now() - interval '7 days'
      AND n.type = 'permanent'
      AND n.archived_at IS NULL
    LIMIT 50
  `);

  let centroid: number[] | null = null;
  if (recentEmbeddings.length > 0) {
    const vecs = recentEmbeddings.map((r) => {
      // pgvector returns "[x,y,z]" format
      const raw = r.vector.replace(/^\[/, "").replace(/\]$/, "");
      return raw.split(",").map(Number);
    });
    centroid = averageVectors(vecs);
  }

  // 3. Fetch embeddings for candidate notes
  const candidateIds = candidates.map((c) => c.id);
  const noteEmbeddings = await db.execute<{ note_id: string; vector: string }>(
    sql`
      SELECT note_id::text, vector::text
      FROM embedding
      WHERE note_id = ANY(${sql.raw(`ARRAY[${candidateIds.map((id) => `'${id}'::uuid`).join(",")}]`)})
    `
  );
  const embeddingMap = new Map<string, number[]>();
  for (const row of noteEmbeddings) {
    const raw = row.vector.replace(/^\[/, "").replace(/\]$/, "");
    embeddingMap.set(row.note_id, raw.split(",").map(Number));
  }

  // 4. Compute hybrid score for each candidate
  const now = Date.now();
  const scored = candidates.map((note) => {
    // base_time_decay: 1 - exp(-days / 14)
    // db.execute returns raw rows; dates may be Date objects or ISO strings
    const lastSeenRaw = note.last_seen_at;
    const lastSeenMs = lastSeenRaw
      ? (lastSeenRaw instanceof Date ? lastSeenRaw : new Date(lastSeenRaw as unknown as string)).getTime()
      : now - 14 * 24 * 60 * 60 * 1000; // default: 14 days ago
    const daysSinceLastSeen = (now - lastSeenMs) / (1000 * 60 * 60 * 24);
    const baseTimeDecay = 1 - Math.exp(-daysSinceLastSeen / 14);

    // embedding_distance contribution
    const noteVec = embeddingMap.get(note.id);
    let embeddingContrib = 0.5; // default when no embeddings
    if (noteVec && centroid) {
      const dist = cosineDistance(noteVec, centroid);
      embeddingContrib = 1 - dist; // lower distance → higher relevance
    }

    const hybridScore = 0.5 * baseTimeDecay + 0.3 * embeddingContrib + 0.2 * 0; // reranker = 0

    return {
      id: note.id,
      title: note.title,
      type: note.type,
      next_due_at: note.next_due_at
        ? (note.next_due_at instanceof Date
            ? note.next_due_at.toISOString()
            : new Date(note.next_due_at as unknown as string).toISOString())
        : null,
      hybrid_score: hybridScore
    };
  });

  // Sort by score DESC, return top 20
  scored.sort((a, b) => b.hybrid_score - a.hybrid_score);
  const top20 = scored.slice(0, 20);

  return c.json({ review: top20 });
});
