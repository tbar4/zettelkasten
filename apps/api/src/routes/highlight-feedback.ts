import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { highlightPromotionFeedback } from "@zk/db-schema";
import { zodErrorHook } from "../lib/zod-error-hook";

export const highlightFeedbackRoute = new Hono();

const PostBodySchema = z.object({
  highlightId: z.string().uuid(),
  action: z.enum(["promoted", "edited", "rejected"]),
  draftText: z.string().optional(),
  finalText: z.string().optional()
});

/**
 * POST /api/highlight-feedback
 *
 * Records a user interaction with a highlight (promoted/edited/rejected).
 * Returns total accumulated event count for cold-start gating.
 */
highlightFeedbackRoute.post(
  "/",
  zValidator("json", PostBodySchema, zodErrorHook),
  async (c) => {
    const body = c.req.valid("json");

    await db.insert(highlightPromotionFeedback).values({
      highlightId: body.highlightId,
      action: body.action,
      draftText: body.draftText ?? null,
      finalText: body.finalText ?? null
    });

    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM highlight_promotion_feedback`
    );
    const count = rows[0]?.count ?? "0";

    return c.json({ count: Number(count) });
  }
);

/**
 * GET /api/highlight-feedback/count
 *
 * Returns total accumulated feedback event count. Used to gate cold-start:
 * if count < 50, classifier falls back to 0.5 default scores.
 */
highlightFeedbackRoute.get("/count", async (c) => {
  const rows = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM highlight_promotion_feedback`
  );
  const count = rows[0]?.count ?? "0";
  return c.json({ count: Number(count) });
});
