import { describe, it, expect, afterEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";
import { setMlClientForInbox } from "../src/routes/inbox";
import type { MLClient } from "../src/lib/ml-client";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  // Reset ML client injection between tests
  setMlClientForInbox(null);
});

/** Stub ML client that returns a fixed score for all highlights. */
function stubMlClient(score: number): MLClient {
  return {
    embed: async () => ({ vectors: [], modelVersion: "stub" }),
    rerank: async () => ({ scores: [] }),
    trainReranker: async () => ({ trained: 0, loss: 0 }),
    scoreHighlights: async (features) => ({ scores: features.map(() => score) }),
    trainClassifier: async () => ({ trained: 0, noop: true })
  };
}

describe("GET /api/inbox", () => {
  it("returns due notes, fleeting notes, and an empty highlights array", async () => {
    const due = (await (
      await post("/api/notes", { title: "DueNote", type: "permanent" })
    ).json()) as { id: string };
    // Force its next_due_at to the past so it's due now.
    await db
      .update(schema.spacedReview)
      .set({ nextDueAt: sql`now() - interval '1 day'` })
      .where(eq(schema.spacedReview.noteId, due.id));

    const fleeting = (await (
      await post("/api/notes", { title: "FleetingNote", type: "fleeting" })
    ).json()) as { id: string };

    // A permanent note with future due date should NOT appear under due.
    await post("/api/notes", { title: "FutureDue", type: "permanent" });

    const res = await app.request("/api/inbox");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      due: { id: string; title: string }[];
      fleeting: { id: string; title: string }[];
      highlights: unknown[];
    };
    expect(body.due.map((n) => n.id)).toEqual([due.id]);
    expect(body.fleeting.map((n) => n.id)).toEqual([fleeting.id]);
    expect(body.highlights).toEqual([]);
  });

  it("excludes archived notes from both panes", async () => {
    const f = (await (
      await post("/api/notes", { title: "F", type: "fleeting" })
    ).json()) as { id: string };
    await app.request(`/api/notes/${f.id}`, { method: "DELETE" });

    const p = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };
    await db
      .update(schema.spacedReview)
      .set({ nextDueAt: sql`now() - interval '1 day'` })
      .where(eq(schema.spacedReview.noteId, p.id));
    await app.request(`/api/notes/${p.id}`, { method: "DELETE" });

    const res = await app.request("/api/inbox");
    const body = (await res.json()) as {
      due: unknown[];
      fleeting: unknown[];
    };
    expect(body.due).toEqual([]);
    expect(body.fleeting).toEqual([]);
  });

  it("includes un-promoted highlights with their source title", async () => {
    const [source] = await db
      .insert(schema.sources)
      .values({ title: "Some Book" })
      .returning();
    const [highlight] = await db
      .insert(schema.highlights)
      .values({ sourceId: source!.id, text: "important quote" })
      .returning();

    const res = await app.request("/api/inbox");
    const body = (await res.json()) as {
      highlights: {
        id: string;
        text: string;
        source_title: string;
      }[];
    };
    expect(body.highlights).toHaveLength(1);
    expect(body.highlights[0]!.id).toBe(highlight!.id);
    expect(body.highlights[0]!.source_title).toBe("Some Book");
    expect(body.highlights[0]!.text).toBe("important quote");
  });

  it("excludes promoted and dismissed highlights", async () => {
    const [source] = await db
      .insert(schema.sources)
      .values({ title: "Book" })
      .returning();
    const [note] = await db
      .insert(schema.notes)
      .values({ type: "literature", title: "lit" })
      .returning();
    await db.insert(schema.highlights).values({
      sourceId: source!.id,
      text: "promoted",
      promotedToNoteId: note!.id
    });
    await db.insert(schema.highlights).values({
      sourceId: source!.id,
      text: "dismissed",
      dismissedAt: new Date()
    });
    await db.insert(schema.highlights).values({
      sourceId: source!.id,
      text: "untouched"
    });

    const res = await app.request("/api/inbox");
    const body = (await res.json()) as {
      highlights: { text: string }[];
    };
    expect(body.highlights.map((h) => h.text)).toEqual(["untouched"]);
  });

  it("includes promotion_score: null when ML service is unavailable", async () => {
    const [source] = await db
      .insert(schema.sources)
      .values({ title: "Score Book" })
      .returning();
    await db.insert(schema.highlights).values({
      sourceId: source!.id,
      text: "score test quote"
    });

    const res = await app.request("/api/inbox");
    const body = (await res.json()) as {
      highlights: { id: string; promotion_score: number | null }[];
    };
    expect(body.highlights).toHaveLength(1);
    // ML service not running in tests → graceful fallback to null
    expect(body.highlights[0]!.promotion_score).toBeNull();
  });

  it("includes promotion_score from ML service when available", async () => {
    setMlClientForInbox(stubMlClient(0.85));

    const [source] = await db
      .insert(schema.sources)
      .values({ title: "ML Book" })
      .returning();
    await db.insert(schema.highlights).values([
      { sourceId: source!.id, text: "high score quote" },
      { sourceId: source!.id, text: "another quote" }
    ]);

    const res = await app.request("/api/inbox");
    const body = (await res.json()) as {
      highlights: { id: string; text: string; promotion_score: number | null }[];
    };
    expect(body.highlights).toHaveLength(2);
    for (const h of body.highlights) {
      expect(h.promotion_score).toBeCloseTo(0.85, 5);
    }
  });

  it("sorts highlights by promotion_score DESC when scores are available", async () => {
    // Return different scores per call position
    let callCount = 0;
    const scoringClient: MLClient = {
      embed: async () => ({ vectors: [], modelVersion: "stub" }),
      rerank: async () => ({ scores: [] }),
      trainReranker: async () => ({ trained: 0, loss: 0 }),
      scoreHighlights: async (features) => ({
        // Assign descending scores so we can verify sort order flips
        scores: features.map((_, i) => 0.9 - i * 0.3)
      }),
      trainClassifier: async () => ({ trained: 0, noop: true })
    };
    setMlClientForInbox(scoringClient);

    const [source] = await db
      .insert(schema.sources)
      .values({ title: "Sort Book" })
      .returning();
    // Insert in a known order; scores will be [0.9, 0.6]
    await db.insert(schema.highlights).values([
      { sourceId: source!.id, text: "first inserted" },
      { sourceId: source!.id, text: "second inserted" }
    ]);

    const res = await app.request("/api/inbox");
    const body = (await res.json()) as {
      highlights: { text: string; promotion_score: number | null }[];
    };
    expect(body.highlights).toHaveLength(2);
    // Highest score should come first
    const scores = body.highlights.map((h) => h.promotion_score!);
    expect(scores[0]!).toBeGreaterThanOrEqual(scores[1]!);
  });
});
