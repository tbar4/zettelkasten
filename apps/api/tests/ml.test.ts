import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

// Helper to insert a note and return its id
async function insertNote(opts: {
  title: string;
  bodyMd?: string;
}): Promise<string> {
  const [row] = await db
    .insert(schema.notes)
    .values({ type: "fleeting", title: opts.title, bodyMd: opts.bodyMd ?? null })
    .returning({ id: schema.notes.id });
  return row!.id;
}

// Helper to insert an embedding for a note
async function insertEmbedding(
  noteId: string,
  opts: { stale?: boolean } = {}
): Promise<void> {
  const vector = `[${Array.from({ length: 768 }, (_, i) => i / 1000).join(",")}]`;
  const generatedAt = opts.stale
    ? "NOW() - INTERVAL '1 hour'"
    : "NOW()";
  await db.execute(
    rawSql`
      INSERT INTO embedding (note_id, vector, model_version, generated_at)
      VALUES (
        ${noteId}::uuid,
        ${vector}::vector,
        'test-model',
        ${rawSql.raw(generatedAt)}
      )
    `
  );
}

describe("GET /api/ml/embedding-status", () => {
  it("returns zeros when there are no notes", async () => {
    const res = await app.request("/api/ml/embedding-status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      embedded: number;
      stale: number;
    };
    expect(body.total).toBe(0);
    expect(body.embedded).toBe(0);
    expect(body.stale).toBe(0);
  });

  it("counts unembedded notes as stale", async () => {
    await insertNote({ title: "Note 1" });
    await insertNote({ title: "Note 2" });

    const res = await app.request("/api/ml/embedding-status");
    const body = (await res.json()) as {
      total: number;
      embedded: number;
      stale: number;
    };
    expect(body.total).toBe(2);
    expect(body.embedded).toBe(0);
    expect(body.stale).toBe(2);
  });

  it("counts up-to-date embeddings correctly", async () => {
    const id1 = await insertNote({ title: "Note 1" });
    const id2 = await insertNote({ title: "Note 2" });
    const id3 = await insertNote({ title: "Note 3" });

    // Embed note 1 and 2 (up to date)
    await insertEmbedding(id1);
    await insertEmbedding(id2);
    // Note 3 has no embedding

    const res = await app.request("/api/ml/embedding-status");
    const body = (await res.json()) as {
      total: number;
      embedded: number;
      stale: number;
    };
    expect(body.total).toBe(3);
    expect(body.embedded).toBe(2);
    expect(body.stale).toBe(1);
  });

  it("counts stale embeddings as stale (not embedded)", async () => {
    const id = await insertNote({ title: "Stale note" });
    await insertEmbedding(id, { stale: true });

    // Bump note.updated_at to be after the embedding
    await db.execute(
      rawSql`UPDATE note SET updated_at = NOW() WHERE id = ${id}::uuid`
    );

    const res = await app.request("/api/ml/embedding-status");
    const body = (await res.json()) as {
      total: number;
      embedded: number;
      stale: number;
    };
    expect(body.total).toBe(1);
    expect(body.embedded).toBe(0);
    expect(body.stale).toBe(1);
  });

  it("excludes archived notes from totals", async () => {
    const id = await insertNote({ title: "Archived note" });
    // Archive it
    await db.execute(
      rawSql`UPDATE note SET archived_at = NOW() WHERE id = ${id}::uuid`
    );

    const res = await app.request("/api/ml/embedding-status");
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(0);
  });
});
