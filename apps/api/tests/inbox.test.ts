import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { app } from "../src/server";

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
});
