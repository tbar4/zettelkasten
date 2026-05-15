import { Hono } from "hono";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notes, spacedReview } from "../db/schema";

export const inboxRoute = new Hono();

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
    .where(and(lte(spacedReview.nextDueAt, sql`now()`), isNull(notes.archivedAt)))
    .orderBy(asc(spacedReview.nextDueAt))
    .limit(20);

  const fleetingRows = await db
    .select({ id: notes.id, title: notes.title, type: notes.type })
    .from(notes)
    .where(and(eq(notes.type, "fleeting"), isNull(notes.archivedAt)))
    .orderBy(desc(notes.createdAt))
    .limit(50);

  return c.json({
    due: dueRows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      next_due_at: r.next_due_at.toISOString()
    })),
    fleeting: fleetingRows,
    highlights: [] as { id: string; text: string }[]
  });
});
