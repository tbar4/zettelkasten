import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";
import { setMlClient } from "../src/routes/search";
import type { MLClient } from "../src/lib/ml-client";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";

const pgClient = postgres(url, { max: 1 });
const db = drizzle(pgClient, { schema });

afterAll(async () => {
  await pgClient.end();
});

/** Generate a 768-dim vector with a given scale so cosines differ predictably */
function makeVector(scale: number): number[] {
  return Array.from({ length: 768 }, (_, i) => Math.cos(i * scale));
}

function vecLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function insertNote(title: string, type = "fleeting"): Promise<string> {
  const [row] = await db
    .insert(schema.notes)
    .values({ type: type as "fleeting", title })
    .returning({ id: schema.notes.id });
  return row!.id;
}

async function insertEmbedding(noteId: string, vec: number[]): Promise<void> {
  await db.execute(rawSql`
    INSERT INTO embedding (note_id, vector, model_version)
    VALUES (${noteId}::uuid, ${vecLiteral(vec)}::vector, 'test-model')
  `);
}

// Mock ML client that returns a controlled vector
function mockMlClient(returnVec: number[]): MLClient {
  return {
    async embed(_texts: string[]) {
      return { vectors: [returnVec], modelVersion: "test-model" };
    }
  };
}

// Failing ML client that throws
function failingMlClient(): MLClient {
  return {
    async embed(_texts: string[]) {
      throw new Error("ML service unavailable");
    }
  };
}

describe("GET /api/search/semantic", () => {
  const vecA = makeVector(0.001); // "close" to query vector
  const vecB = makeVector(0.5);   // medium distance
  const vecC = makeVector(1.0);   // furthest

  beforeEach(() => {
    // Reset to failing by default so tests opt in to mock
    setMlClient(failingMlClient());
  });

  afterAll(() => {
    setMlClient(null);
  });

  it("returns 400 if q is empty", async () => {
    setMlClient(mockMlClient(vecA));
    const res = await app.request("/api/search/semantic?q=");
    expect(res.status).toBe(400);
  });

  it("returns ml-unavailable when ML service fails", async () => {
    setMlClient(failingMlClient());
    const res = await app.request("/api/search/semantic?q=test");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; reason: string };
    expect(body.results).toHaveLength(0);
    expect(body.reason).toBe("ml-unavailable");
  });

  it("returns empty results when no embeddings exist", async () => {
    setMlClient(mockMlClient(vecA));
    await insertNote("Unembedded note");
    const res = await app.request("/api/search/semantic?q=hello");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(0);
  });

  it("returns results ordered by cosine similarity descending", async () => {
    const queryVec = makeVector(0.001);
    setMlClient(mockMlClient(queryVec));

    const idA = await insertNote("Note A");
    const idB = await insertNote("Note B");
    const idC = await insertNote("Note C");

    // vecA is closest to queryVec (same scale), vecC is furthest
    await insertEmbedding(idA, vecA);
    await insertEmbedding(idB, vecB);
    await insertEmbedding(idC, vecC);

    const res = await app.request("/api/search/semantic?q=hello&limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { id: string; title: string; type: string; similarity: number }[];
    };

    expect(body.results).toHaveLength(3);
    // First result should be note A (most similar)
    expect(body.results[0]!.id).toBe(idA);
    expect(body.results[0]!.similarity).toBeGreaterThan(body.results[1]!.similarity);
    expect(body.results[1]!.similarity).toBeGreaterThan(body.results[2]!.similarity);
  });

  it("respects the limit parameter", async () => {
    setMlClient(mockMlClient(vecA));
    const id1 = await insertNote("Note 1");
    const id2 = await insertNote("Note 2");
    const id3 = await insertNote("Note 3");
    await insertEmbedding(id1, vecA);
    await insertEmbedding(id2, vecB);
    await insertEmbedding(id3, vecC);

    const res = await app.request("/api/search/semantic?q=hello&limit=2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(2);
  });

  it("excludes archived notes", async () => {
    setMlClient(mockMlClient(vecA));
    const id = await insertNote("Archived note");
    await insertEmbedding(id, vecA);
    await db.execute(rawSql`UPDATE note SET archived_at = NOW() WHERE id = ${id}::uuid`);

    const res = await app.request("/api/search/semantic?q=hello");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string }[] };
    expect(body.results.find((r) => r.id === id)).toBeUndefined();
  });
});

describe("GET /api/notes/:id/related", () => {
  const vecA = makeVector(0.001);
  const vecB = makeVector(0.5);
  const vecC = makeVector(1.0);

  afterAll(() => {
    setMlClient(null);
  });

  it("returns no-embedding when source note has no embedding", async () => {
    const id = await insertNote("No embedding note");
    const res = await app.request(`/api/notes/${id}/related`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; reason: string };
    expect(body.results).toHaveLength(0);
    expect(body.reason).toBe("no-embedding");
  });

  it("returns related notes ordered by similarity, excluding self", async () => {
    const idA = await insertNote("Note A");
    const idB = await insertNote("Note B");
    const idC = await insertNote("Note C");

    await insertEmbedding(idA, vecA);
    await insertEmbedding(idB, vecB);
    await insertEmbedding(idC, vecC);

    const res = await app.request(`/api/notes/${idA}/related?limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { id: string; title: string; similarity: number }[];
    };

    // Self should be excluded
    expect(body.results.find((r) => r.id === idA)).toBeUndefined();
    // Should have idB and idC
    expect(body.results).toHaveLength(2);
    // idB (vecB, scale=0.5) should be more similar to idA (vecA, scale=0.001)
    // than idC (vecC, scale=1.0)
    expect(body.results[0]!.id).toBe(idB);
    expect(body.results[0]!.similarity).toBeGreaterThan(body.results[1]!.similarity);
  });

  it("respects limit parameter", async () => {
    const id1 = await insertNote("Note 1");
    const id2 = await insertNote("Note 2");
    const id3 = await insertNote("Note 3");
    const id4 = await insertNote("Note 4");

    await insertEmbedding(id1, vecA);
    await insertEmbedding(id2, vecA);
    await insertEmbedding(id3, vecB);
    await insertEmbedding(id4, vecC);

    const res = await app.request(`/api/notes/${id1}/related?limit=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(2);
  });

  it("excludes archived notes from related results", async () => {
    const idA = await insertNote("Note A");
    const idB = await insertNote("Archived B");

    await insertEmbedding(idA, vecA);
    await insertEmbedding(idB, vecA); // same vector = most similar
    await db.execute(rawSql`UPDATE note SET archived_at = NOW() WHERE id = ${idB}::uuid`);

    const res = await app.request(`/api/notes/${idA}/related`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string }[] };
    expect(body.results.find((r) => r.id === idB)).toBeUndefined();
  });
});
