import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";

const url =
  process.env.DATABASE_URL_TEST ?? "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

interface ReviewItem {
  id: string;
  title: string;
  type: string;
  next_due_at: string | null;
  hybrid_score: number;
}

describe("GET /api/inbox/review", () => {
  it("returns empty array when no candidates exist", async () => {
    const res = await app.request("/api/inbox/review");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { review: ReviewItem[] };
    expect(body.review).toEqual([]);
  });

  it("includes permanent notes with next_due_at <= now", async () => {
    const created = (await (
      await post("/api/notes", { title: "DueForReview", type: "permanent" })
    ).json()) as { id: string };
    // Force next_due_at to the past
    await db
      .update(schema.spacedReview)
      .set({ nextDueAt: sql`now() - interval '1 day'` })
      .where(eq(schema.spacedReview.noteId, created.id));

    const res = await app.request("/api/inbox/review");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { review: ReviewItem[] };
    const ids = body.review.map((r) => r.id);
    expect(ids).toContain(created.id);
  });

  it("includes permanent notes with no spaced_review row", async () => {
    // Insert directly without triggering the note creation hook
    const [note] = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "NoReviewRow" })
      .returning();

    const res = await app.request("/api/inbox/review");
    const body = (await res.json()) as { review: ReviewItem[] };
    const ids = body.review.map((r) => r.id);
    expect(ids).toContain(note!.id);
  });

  it("excludes permanent notes with future next_due_at", async () => {
    const created = (await (
      await post("/api/notes", { title: "NotDueYet", type: "permanent" })
    ).json()) as { id: string };
    // The note creation sets next_due_at = now() + 1 day by default; leave it

    const res = await app.request("/api/inbox/review");
    const body = (await res.json()) as { review: ReviewItem[] };
    const ids = body.review.map((r) => r.id);
    expect(ids).not.toContain(created.id);
  });

  it("excludes archived notes", async () => {
    const created = (await (
      await post("/api/notes", { title: "Archived", type: "permanent" })
    ).json()) as { id: string };
    await db
      .update(schema.spacedReview)
      .set({ nextDueAt: sql`now() - interval '1 day'` })
      .where(eq(schema.spacedReview.noteId, created.id));
    await app.request(`/api/notes/${created.id}`, { method: "DELETE" });

    const res = await app.request("/api/inbox/review");
    const body = (await res.json()) as { review: ReviewItem[] };
    const ids = body.review.map((r) => r.id);
    expect(ids).not.toContain(created.id);
  });

  it("returns results with hybrid_score between 0 and 1", async () => {
    const created = (await (
      await post("/api/notes", { title: "Scored", type: "permanent" })
    ).json()) as { id: string };
    await db
      .update(schema.spacedReview)
      .set({ nextDueAt: sql`now() - interval '7 days'` })
      .where(eq(schema.spacedReview.noteId, created.id));

    const res = await app.request("/api/inbox/review");
    const body = (await res.json()) as { review: ReviewItem[] };
    const item = body.review.find((r) => r.id === created.id);
    expect(item).toBeDefined();
    expect(item!.hybrid_score).toBeGreaterThanOrEqual(0);
    expect(item!.hybrid_score).toBeLessThanOrEqual(1);
  });

  it("returns at most 20 candidates", async () => {
    // Insert 25 permanent notes all due now
    await Promise.all(
      Array.from({ length: 25 }).map(async (_, i) => {
        const n = (await (
          await post("/api/notes", { title: `Bulk${i}`, type: "permanent" })
        ).json()) as { id: string };
        await db
          .update(schema.spacedReview)
          .set({ nextDueAt: sql`now() - interval '1 day'` })
          .where(eq(schema.spacedReview.noteId, n.id));
      })
    );

    const res = await app.request("/api/inbox/review");
    const body = (await res.json()) as { review: ReviewItem[] };
    expect(body.review.length).toBeLessThanOrEqual(20);
  });

  it("sorts by hybrid_score descending", async () => {
    // Create notes with different last_seen_at to produce different scores
    const n1 = (await (
      await post("/api/notes", { title: "OldNote", type: "permanent" })
    ).json()) as { id: string };
    const n2 = (await (
      await post("/api/notes", { title: "NewNote", type: "permanent" })
    ).json()) as { id: string };

    // Make n1 very stale (high time_decay) and n2 slightly stale
    await db.execute(sql`
      UPDATE spaced_review
      SET next_due_at = now() - interval '1 day',
          last_seen_at = now() - interval '60 days'
      WHERE note_id = ${n1.id}
    `);
    await db.execute(sql`
      UPDATE spaced_review
      SET next_due_at = now() - interval '1 day',
          last_seen_at = now() - interval '1 day'
      WHERE note_id = ${n2.id}
    `);

    const res = await app.request("/api/inbox/review");
    const body = (await res.json()) as { review: ReviewItem[] };

    // Verify scores are in descending order
    const scores = body.review.map((r) => r.hybrid_score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]!).toBeGreaterThanOrEqual(scores[i]!);
    }
  });
});
