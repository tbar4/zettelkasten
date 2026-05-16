import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { runSync } from "../src/sync.js";
import type { MLClient } from "../src/ml-client.js";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";

const pgClient = postgres(url, { max: 1 });
const db = drizzle(pgClient, { schema });

// Fake ML client: returns deterministic 768-dim vectors
function fakeMlClient(overrides?: Partial<MLClient>): MLClient {
  return {
    async embed(texts: string[]) {
      const vectors = texts.map((_, i) =>
        Array.from({ length: 768 }, (_, j) => (i + j) / 1000)
      );
      return { vectors, modelVersion: "test-model-v1" };
    },
    ...overrides
  };
}

beforeEach(async () => {
  await db.execute(
    rawSql`TRUNCATE TABLE manuscript_section, manuscript, canvas_edge, canvas_item, canvas, note_source, highlight, source, spaced_review, note_tag, note_link, custom_link_type, tag, embedding, note RESTART IDENTITY CASCADE`
  );
});

afterAll(async () => {
  await pgClient.end();
});

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

describe("runSync", () => {
  it("returns 0 embedded when no notes exist", async () => {
    const result = await runSync(db as any, fakeMlClient());
    expect(result.embedded).toBe(0);
  });

  it("embeds a single note that has no embedding row", async () => {
    const id = await insertNote({ title: "Test note", bodyMd: "Hello world" });
    const client = fakeMlClient();
    const embedSpy = vi.spyOn(client, "embed");

    const result = await runSync(db as any, client);

    expect(result.embedded).toBe(1);
    expect(embedSpy).toHaveBeenCalledOnce();
    // embed called with the body text (not the title)
    expect(embedSpy).toHaveBeenCalledWith(["Hello world"]);

    // Verify row in DB
    const rows = await db.select().from(schema.embeddings).where(rawSql`note_id = ${id}::uuid`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.modelVersion).toBe("test-model-v1");
    // vector should be 768-dim
    expect(rows[0]!.vector).toHaveLength(768);
  });

  it("uses note title as text when bodyMd is null", async () => {
    await insertNote({ title: "Title only note" });
    const client = fakeMlClient();
    const embedSpy = vi.spyOn(client, "embed");

    await runSync(db as any, client);

    expect(embedSpy).toHaveBeenCalledWith(["Title only note"]);
  });

  it("embeds multiple notes", async () => {
    await insertNote({ title: "Note 1", bodyMd: "Body 1" });
    await insertNote({ title: "Note 2", bodyMd: "Body 2" });
    await insertNote({ title: "Note 3", bodyMd: "Body 3" });

    const result = await runSync(db as any, fakeMlClient());

    expect(result.embedded).toBe(3);
  });

  it("skips notes that already have an up-to-date embedding", async () => {
    const id = await insertNote({ title: "Already embedded" });

    // Insert an embedding for this note with generated_at = now
    // (note.updated_at <= embedding.generated_at  => no re-embed needed)
    await db.execute(
      rawSql`
        INSERT INTO embedding (note_id, vector, model_version, generated_at)
        VALUES (
          ${id}::uuid,
          ${`[${Array.from({ length: 768 }, (_, i) => i / 1000).join(",")}]`}::vector,
          'old-model',
          NOW()
        )
      `
    );

    const client = fakeMlClient();
    const embedSpy = vi.spyOn(client, "embed");
    const result = await runSync(db as any, client);

    expect(result.embedded).toBe(0);
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it("re-embeds a note whose embedding is stale (generated_at < updated_at)", async () => {
    const id = await insertNote({ title: "Stale note", bodyMd: "Old body" });

    // Insert a stale embedding (generated_at in the past)
    await db.execute(
      rawSql`
        INSERT INTO embedding (note_id, vector, model_version, generated_at)
        VALUES (
          ${id}::uuid,
          ${`[${Array.from({ length: 768 }, (_, i) => i / 1000).join(",")}]`}::vector,
          'old-model',
          NOW() - INTERVAL '1 hour'
        )
      `
    );

    // Bump note.updated_at to be after the embedding
    await db.execute(
      rawSql`UPDATE note SET updated_at = NOW() WHERE id = ${id}::uuid`
    );

    const result = await runSync(db as any, fakeMlClient());

    expect(result.embedded).toBe(1);

    // Embedding should be updated
    const rows = await db.select().from(schema.embeddings).where(rawSql`note_id = ${id}::uuid`);
    expect(rows[0]!.modelVersion).toBe("test-model-v1");
  });

  it("processes notes in batches of 32", async () => {
    // Insert 35 notes
    for (let i = 0; i < 35; i++) {
      await insertNote({ title: `Note ${i}`, bodyMd: `Body ${i}` });
    }

    const client = fakeMlClient();
    const embedSpy = vi.spyOn(client, "embed");

    const result = await runSync(db as any, client);

    expect(result.embedded).toBe(35);
    // First batch: 32, second batch: 3
    expect(embedSpy).toHaveBeenCalledTimes(2);
    expect(embedSpy.mock.calls[0]![0]).toHaveLength(32);
    expect(embedSpy.mock.calls[1]![0]).toHaveLength(3);
  });
});
