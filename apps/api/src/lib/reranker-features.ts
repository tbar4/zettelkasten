/**
 * Feature extraction for the personal re-ranker.
 *
 * Given (fromNoteId | null, candidateNoteId), computes a 5-dim feature vector:
 *   [0] cosine_sim            — cosine similarity from embedding table (0 if missing)
 *   [1] shared_tags_count     — count of shared tags (0 if no fromNoteId)
 *   [2] same_type_flag        — 1 if note.type matches, else 0 (0 if no fromNoteId)
 *   [3] link_density_ratio    — 1 if any note_link exists between notes, else 0
 *   [4] temporal_proximity    — 1 / (1 + |days_between_updates|), capped at 1
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client";

export interface RerankerFeatures {
  cosineSim: number;
  sharedTagsCount: number;
  sameTypeFlag: number;
  linkDensityRatio: number;
  temporalProximityDays: number;
}

/**
 * Compute feature vector for one (fromNoteId, toNoteId) pair.
 *
 * If fromNoteId is null, features that require two notes default to 0.
 */
export async function computeFeatures(
  fromNoteId: string | null,
  toNoteId: string
): Promise<RerankerFeatures> {
  if (fromNoteId === null) {
    // Only cosine_sim is meaningful — but without a "from" embedding we can't
    // compute it either. Return zeros for all features.
    return {
      cosineSim: 0,
      sharedTagsCount: 0,
      sameTypeFlag: 0,
      linkDensityRatio: 0,
      temporalProximityDays: 0
    };
  }

  // Single query: compute all features in one round-trip.
  const [row] = await db.execute<{
    cosine_sim: string | null;
    shared_tags_count: string;
    same_type_flag: string;
    link_exists: string;
    days_diff: string | null;
  }>(sql`
    WITH
      from_note AS (
        SELECT type, updated_at FROM note WHERE id = ${fromNoteId}::uuid
      ),
      to_note AS (
        SELECT type, updated_at FROM note WHERE id = ${toNoteId}::uuid
      ),
      from_emb AS (
        SELECT vector FROM embedding WHERE note_id = ${fromNoteId}::uuid
      ),
      to_emb AS (
        SELECT vector FROM embedding WHERE note_id = ${toNoteId}::uuid
      ),
      sim AS (
        SELECT
          CASE
            WHEN (SELECT COUNT(*) FROM from_emb) = 0 OR (SELECT COUNT(*) FROM to_emb) = 0
            THEN NULL
            ELSE 1 - ((SELECT vector FROM from_emb) <=> (SELECT vector FROM to_emb))
          END AS cosine_sim
      ),
      shared_tags AS (
        SELECT COUNT(*) AS cnt
        FROM note_tag nt1
        JOIN note_tag nt2 ON nt1.tag_id = nt2.tag_id
        WHERE nt1.note_id = ${fromNoteId}::uuid
          AND nt2.note_id = ${toNoteId}::uuid
      ),
      link_check AS (
        SELECT COUNT(*) AS cnt
        FROM note_link
        WHERE (from_note_id = ${fromNoteId}::uuid AND to_note_id = ${toNoteId}::uuid)
           OR (from_note_id = ${toNoteId}::uuid AND to_note_id = ${fromNoteId}::uuid)
      )
    SELECT
      sim.cosine_sim::text AS cosine_sim,
      (SELECT cnt FROM shared_tags)::text AS shared_tags_count,
      CASE WHEN (SELECT type FROM from_note) = (SELECT type FROM to_note) THEN '1' ELSE '0' END AS same_type_flag,
      CASE WHEN (SELECT cnt FROM link_check) > 0 THEN '1' ELSE '0' END AS link_exists,
      ABS(
        EXTRACT(EPOCH FROM (SELECT updated_at FROM from_note))
        - EXTRACT(EPOCH FROM (SELECT updated_at FROM to_note))
      ) / 86400.0 AS days_diff
    FROM sim
  `);

  if (!row) {
    return {
      cosineSim: 0,
      sharedTagsCount: 0,
      sameTypeFlag: 0,
      linkDensityRatio: 0,
      temporalProximityDays: 0
    };
  }

  const cosineSim = row.cosine_sim !== null ? Number(row.cosine_sim) : 0;
  const sharedTagsCount = Number(row.shared_tags_count);
  const sameTypeFlag = Number(row.same_type_flag);
  const linkDensityRatio = Number(row.link_exists);
  const daysDiff = row.days_diff !== null ? Number(row.days_diff) : 0;
  const temporalProximityDays = Math.min(1, 1 / (1 + daysDiff));

  return {
    cosineSim,
    sharedTagsCount,
    sameTypeFlag,
    linkDensityRatio,
    temporalProximityDays
  };
}

/**
 * Convert feature object to the 5-dim array expected by the ML service.
 */
export function featuresToVector(f: RerankerFeatures): number[] {
  return [
    f.cosineSim,
    f.sharedTagsCount,
    f.sameTypeFlag,
    f.linkDensityRatio,
    f.temporalProximityDays
  ];
}
