import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";

const url =
  process.env.DATABASE_URL_TEST ?? "postgres://zk:zk@localhost:5433/zettel_test";
const pgClient = postgres(url, { max: 1 });
const db = drizzle(pgClient, { schema });

/** Helper: insert a note and return its id */
async function insertNote(title: string): Promise<string> {
  const [row] = await db
    .insert(schema.notes)
    .values({ type: "fleeting", title })
    .returning({ id: schema.notes.id });
  return row!.id;
}

describe("POST /api/suggestion-feedback", () => {
  it("records accepted feedback and returns count", async () => {
    const fromId = await insertNote("Source note");
    const toId = await insertNote("Target note");

    const res = await app.request("/api/suggestion-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromNoteId: fromId,
        toNoteId: toId,
        action: "accepted",
        surfacedAt: new Date().toISOString()
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
  });

  it("records feedback without fromNoteId (ask page flow)", async () => {
    const toId = await insertNote("Cited note");

    const res = await app.request("/api/suggestion-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toNoteId: toId,
        action: "dismissed",
        surfacedAt: new Date().toISOString()
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid action", async () => {
    const toId = await insertNote("Target note");

    const res = await app.request("/api/suggestion-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toNoteId: toId,
        action: "invalid-action",
        surfacedAt: new Date().toISOString()
      })
    });

    expect(res.status).toBe(400);
  });

  it("rejects missing toNoteId", async () => {
    const res = await app.request("/api/suggestion-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "accepted",
        surfacedAt: new Date().toISOString()
      })
    });

    expect(res.status).toBe(400);
  });

  it("accumulates count across multiple feedback rows", async () => {
    const from = await insertNote("From note");
    const to1 = await insertNote("To note 1");
    const to2 = await insertNote("To note 2");

    await app.request("/api/suggestion-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromNoteId: from,
        toNoteId: to1,
        action: "accepted",
        surfacedAt: new Date().toISOString()
      })
    });
    const res = await app.request("/api/suggestion-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromNoteId: from,
        toNoteId: to2,
        action: "rejected",
        surfacedAt: new Date().toISOString()
      })
    });

    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /api/suggestion-feedback/count", () => {
  it("returns count of 0 when table is empty", async () => {
    const res = await app.request("/api/suggestion-feedback/count");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(0);
  });

  it("returns count matching inserted rows", async () => {
    const to = await insertNote("Target");
    const from = await insertNote("Source");

    await app.request("/api/suggestion-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromNoteId: from,
        toNoteId: to,
        action: "accepted",
        surfacedAt: new Date().toISOString()
      })
    });

    const res = await app.request("/api/suggestion-feedback/count");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
  });
});
