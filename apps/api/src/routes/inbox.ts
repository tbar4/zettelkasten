import { Hono } from "hono";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notes, spacedReview, sources, highlights } from "@zk/db-schema";
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
