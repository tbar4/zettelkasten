import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { suggestionFeedback } from "@zk/db-schema";
import { zodErrorHook } from "../lib/zod-error-hook";

export const suggestionFeedbackRoute = new Hono();

const PostBodySchema = z.object({
  fromNoteId: z.string().uuid().optional(),
  toNoteId: z.string().uuid(),
  action: z.enum(["accepted", "rejected", "dismissed"]),
  surfacedAt: z.string().datetime()
});

/**
 * POST /api/suggestion-feedback
 *
 * Records a user interaction with a suggested note. Returns the total
 * accumulated event count (used by clients to gauge cold-start status).
 */
suggestionFeedbackRoute.post(
  "/",
  zValidator("json", PostBodySchema, zodErrorHook),
  async (c) => {
    const body = c.req.valid("json");

    await db.insert(suggestionFeedback).values({
      fromNoteId: body.fromNoteId ?? null,
      toNoteId: body.toNoteId,
      action: body.action,
      surfacedAt: new Date(body.surfacedAt)
    });

    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM suggestion_feedback`
    );
    const count = rows[0]?.count ?? "0";

    return c.json({ count: Number(count) });
  }
);

/**
 * GET /api/suggestion-feedback/count
 *
 * Returns total accumulated feedback event count. Used to gate cold-start:
 * if count < 30, the API falls back to raw embedding order (no re-ranking).
 */
suggestionFeedbackRoute.get("/count", async (c) => {
  const rows = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM suggestion_feedback`
  );
  const count = rows[0]?.count ?? "0";
  return c.json({ count: Number(count) });
});
