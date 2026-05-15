import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@zk/db-schema";
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

describe("spaced review scheduling", () => {
  it("creates a spaced_review row when a permanent note is created", async () => {
    const created = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };
    const rows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.intervalDays).toBe(1);
  });

  it("creates a spaced_review row when a fleeting is promoted to permanent", async () => {
    const created = (await (
      await post("/api/notes", { title: "F", type: "fleeting" })
    ).json()) as { id: string; updated_at: string };
    expect(
      (await db
        .select()
        .from(schema.spacedReview)
        .where(eq(schema.spacedReview.noteId, created.id))).length
    ).toBe(0);

    await app.request(`/api/notes/${created.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": created.updated_at
      },
      body: JSON.stringify({ type: "permanent" })
    });

    const rows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(rows).toHaveLength(1);
  });

  it("does NOT create a spaced_review row for non-permanent notes", async () => {
    const created = (await (
      await post("/api/notes", { title: "F", type: "fleeting" })
    ).json()) as { id: string };
    const rows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(rows).toEqual([]);
  });
});

describe("POST /api/notes/:id/review", () => {
  it("keep action bumps interval to next step (1→3)", async () => {
    const created = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };

    const res = await post(`/api/notes/${created.id}/review`, {
      action: "keep"
    });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(rows[0]!.intervalDays).toBe(3);
  });

  it("archive action archives the note and removes the spaced_review row", async () => {
    const created = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };

    const res = await post(`/api/notes/${created.id}/review`, {
      action: "archive"
    });
    expect(res.status).toBe(204);

    const reviewRows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(reviewRows).toEqual([]);

    const noteRows = await db
      .select()
      .from(schema.notes)
      .where(eq(schema.notes.id, created.id));
    expect(noteRows[0]!.archivedAt).not.toBeNull();
  });

  it("returns 404 for an unknown note id", async () => {
    const res = await post(
      "/api/notes/550e8400-e29b-41d4-a716-446655440099/review",
      { action: "keep" }
    );
    expect(res.status).toBe(404);
  });

  it("400 on unknown action", async () => {
    const created = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };
    const res = await post(`/api/notes/${created.id}/review`, {
      action: "delete"
    });
    expect(res.status).toBe(400);
  });
});
