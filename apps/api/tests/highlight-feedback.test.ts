import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";

const url =
  process.env.DATABASE_URL_TEST ?? "postgres://zk:zk@localhost:5433/zettel_test";
const pgClient = postgres(url, { max: 1 });
const db = drizzle(pgClient, { schema });

async function insertSource(title: string): Promise<string> {
  const [row] = await db
    .insert(schema.sources)
    .values({ title })
    .returning({ id: schema.sources.id });
  return row!.id;
}

async function insertHighlight(sourceId: string, text: string): Promise<string> {
  const [row] = await db
    .insert(schema.highlights)
    .values({ sourceId, text })
    .returning({ id: schema.highlights.id });
  return row!.id;
}

describe("POST /api/highlight-feedback", () => {
  it("records promoted feedback and returns count", async () => {
    const sourceId = await insertSource("Test Book");
    const highlightId = await insertHighlight(sourceId, "A great quote");

    const res = await app.request("/api/highlight-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        highlightId,
        action: "promoted",
        draftText: "A great quote",
        finalText: "A great quote"
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
  });

  it("records rejected feedback without optional fields", async () => {
    const sourceId = await insertSource("Book 2");
    const highlightId = await insertHighlight(sourceId, "Meh quote");

    const res = await app.request("/api/highlight-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        highlightId,
        action: "rejected"
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
  });

  it("records edited feedback with before/after text", async () => {
    const sourceId = await insertSource("Book 3");
    const highlightId = await insertHighlight(sourceId, "Raw quote");

    const res = await app.request("/api/highlight-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        highlightId,
        action: "edited",
        draftText: "Raw quote",
        finalText: "Polished quote"
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid action", async () => {
    const sourceId = await insertSource("Book 4");
    const highlightId = await insertHighlight(sourceId, "Some quote");

    const res = await app.request("/api/highlight-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        highlightId,
        action: "bad-action"
      })
    });

    expect(res.status).toBe(400);
  });

  it("rejects missing highlightId", async () => {
    const res = await app.request("/api/highlight-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rejected" })
    });

    expect(res.status).toBe(400);
  });

  it("accumulates count across multiple rows", async () => {
    const sourceId = await insertSource("Book 5");
    const h1 = await insertHighlight(sourceId, "Quote 1");
    const h2 = await insertHighlight(sourceId, "Quote 2");

    await app.request("/api/highlight-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ highlightId: h1, action: "promoted" })
    });

    const res = await app.request("/api/highlight-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ highlightId: h2, action: "rejected" })
    });

    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /api/highlight-feedback/count", () => {
  it("returns 0 when table is empty", async () => {
    const res = await app.request("/api/highlight-feedback/count");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(0);
  });

  it("returns correct count after inserts", async () => {
    const sourceId = await insertSource("Count Test Book");
    const highlightId = await insertHighlight(sourceId, "Count test quote");

    await app.request("/api/highlight-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ highlightId, action: "promoted" })
    });

    const res = await app.request("/api/highlight-feedback/count");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
  });
});
