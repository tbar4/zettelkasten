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

async function createHighlight(opts: {
  sourceTitle: string;
  text: string;
}): Promise<{ sourceId: string; highlightId: string }> {
  const [source] = await db
    .insert(schema.sources)
    .values({ title: opts.sourceTitle })
    .returning();
  const [highlight] = await db
    .insert(schema.highlights)
    .values({ sourceId: source!.id, text: opts.text })
    .returning();
  return { sourceId: source!.id, highlightId: highlight!.id };
}

describe("POST /api/highlights/:id/promote", () => {
  it("creates a literature note and links it to the source", async () => {
    const { sourceId, highlightId } = await createHighlight({
      sourceTitle: "Discipline & Punish",
      text: "Power is exercised through visibility."
    });

    const res = await app.request(`/api/highlights/${highlightId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(201);
    const note = (await res.json()) as {
      id: string;
      type: string;
      body_md: string;
    };
    expect(note.type).toBe("literature");
    expect(note.body_md).toContain("Power is exercised through visibility.");

    const [h] = await db
      .select()
      .from(schema.highlights)
      .where(eq(schema.highlights.id, highlightId));
    expect(h!.promotedToNoteId).toBe(note.id);

    const ns = await db
      .select()
      .from(schema.noteSources)
      .where(eq(schema.noteSources.noteId, note.id));
    expect(ns).toHaveLength(1);
    expect(ns[0]!.sourceId).toBe(sourceId);
  });

  it("returns 404 for an unknown highlight id", async () => {
    const res = await app.request(
      "/api/highlights/550e8400-e29b-41d4-a716-446655440099/promote",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 if highlight already promoted", async () => {
    const { highlightId } = await createHighlight({
      sourceTitle: "S",
      text: "T"
    });
    await app.request(`/api/highlights/${highlightId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const res = await app.request(`/api/highlights/${highlightId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(409);
  });

  it("optionally overrides title", async () => {
    const { highlightId } = await createHighlight({
      sourceTitle: "Author",
      text: "Quote text"
    });
    const res = await app.request(`/api/highlights/${highlightId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Custom Title" })
    });
    const note = (await res.json()) as { title: string };
    expect(note.title).toBe("Custom Title");
  });
});
