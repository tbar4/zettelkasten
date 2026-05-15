import { eq } from "drizzle-orm";
import { notes, spacedReview } from "../db/schema";

const LADDER = [1, 3, 7, 14, 30, 90];

function nextInterval(current: number): number {
  const idx = LADDER.indexOf(current);
  if (idx === -1) return LADDER[0]!;
  return LADDER[Math.min(idx + 1, LADDER.length - 1)]!;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export async function scheduleReview(
  // The looser type lets us pass either the main db or a transaction handle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  noteId: string
): Promise<void> {
  const now = new Date();
  await db
    .insert(spacedReview)
    .values({
      noteId,
      lastSeenAt: now,
      nextDueAt: addDays(now, LADDER[0]!),
      intervalDays: LADDER[0]!
    })
    .onConflictDoNothing({ target: spacedReview.noteId });
}

export async function applyKeep(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  noteId: string
): Promise<{ intervalDays: number; nextDueAt: Date } | null> {
  const [existing] = await db
    .select()
    .from(spacedReview)
    .where(eq(spacedReview.noteId, noteId));
  if (!existing) return null;
  const newInterval = nextInterval(existing.intervalDays);
  const now = new Date();
  const [updated] = await db
    .update(spacedReview)
    .set({
      lastSeenAt: now,
      nextDueAt: addDays(now, newInterval),
      intervalDays: newInterval
    })
    .where(eq(spacedReview.noteId, noteId))
    .returning();
  return updated
    ? { intervalDays: updated.intervalDays, nextDueAt: updated.nextDueAt }
    : null;
}

export async function applyArchive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  noteId: string
): Promise<boolean> {
  const archived = await db
    .update(notes)
    .set({ archivedAt: new Date() })
    .where(eq(notes.id, noteId))
    .returning({ id: notes.id });
  if (archived.length === 0) return false;
  await db.delete(spacedReview).where(eq(spacedReview.noteId, noteId));
  return true;
}
