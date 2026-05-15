import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { syncWikilinks } from "../src/lib/wikilinks-sync";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function createNote(title: string): Promise<string> {
  const [row] = await db
    .insert(schema.notes)
    .values({ type: "permanent", title })
    .returning({ id: schema.notes.id });
  return row!.id;
}

describe("syncWikilinks", () => {
  it("creates wikilink rows for resolved [[title]] mentions", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    await db
      .update(schema.notes)
      .set({ bodyMd: "See [[B]] for more" })
      .where(eq(schema.notes.id, a));

    await syncWikilinks(db, a, "See [[B]] for more");

    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toHaveLength(1);
    expect(links[0]!.toNoteId).toBe(b);
    expect(links[0]!.linkType).toBe("references");
    expect(links[0]!.source).toBe("wikilink");
  });

  it("removes wikilink rows when the wikilink is deleted from body", async () => {
    const a = await createNote("A");
    await createNote("B");
    await syncWikilinks(db, a, "See [[B]]");
    expect(
      (await db.select().from(schema.noteLinks).where(eq(schema.noteLinks.fromNoteId, a)))
        .length
    ).toBe(1);

    await syncWikilinks(db, a, "no more links");

    const after = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(after).toEqual([]);
  });

  it("never touches manual links", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    await db.insert(schema.noteLinks).values({
      fromNoteId: a,
      toNoteId: b,
      linkType: "supports",
      source: "manual"
    });

    await syncWikilinks(db, a, "no wikilinks here");

    const after = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(after).toHaveLength(1);
    expect(after[0]!.linkType).toBe("supports");
    expect(after[0]!.source).toBe("manual");
  });

  it("ignores unresolved wikilinks (no matching title)", async () => {
    const a = await createNote("A");
    await syncWikilinks(db, a, "See [[NoSuchNote]]");
    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toEqual([]);
  });

  it("ignores self-references (wikilink to the note's own title)", async () => {
    const a = await createNote("A");
    await syncWikilinks(db, a, "See [[A]]");
    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toEqual([]);
  });

  it("deduplicates repeated wikilinks to the same target", async () => {
    const a = await createNote("A");
    await createNote("B");
    await syncWikilinks(db, a, "[[B]] [[B]] [[B]]");
    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toHaveLength(1);
  });

  it("handles null body_md as 'no wikilinks'", async () => {
    const a = await createNote("A");
    await createNote("B");
    await syncWikilinks(db, a, "[[B]]");
    await syncWikilinks(db, a, null);
    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toEqual([]);
  });

  it("does not 500 when a manual link already exists at the same (from,to,type)", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    // Pre-existing manual references link
    await db.insert(schema.noteLinks).values({
      fromNoteId: a,
      toNoteId: b,
      linkType: "references",
      source: "manual"
    });

    // syncWikilinks must not throw on the duplicate; the manual row remains untouched.
    await expect(syncWikilinks(db, a, "[[B]]")).resolves.toBeUndefined();

    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    // Manual row wins; no second row inserted.
    expect(links).toHaveLength(1);
    expect(links[0]!.source).toBe("manual");
  });

  it("resolves wikilinks case-insensitively", async () => {
    const a = await createNote("A");
    const target = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Foucault" })
      .returning({ id: schema.notes.id });
    const targetId = target[0]!.id;

    await syncWikilinks(db, a, "see [[foucault]]");

    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toHaveLength(1);
    expect(links[0]!.toNoteId).toBe(targetId);
  });

  it("picks the newest match deterministically on ambiguous titles", async () => {
    const a = await createNote("A");
    await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Dup" })
      .returning({ id: schema.notes.id });
    // Force the second insert to have a strictly later createdAt.
    await new Promise((r) => setTimeout(r, 5));
    const newer = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Dup" })
      .returning({ id: schema.notes.id });

    await syncWikilinks(db, a, "[[Dup]]");

    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toHaveLength(1);
    expect(links[0]!.toNoteId).toBe(newer[0]!.id);
  });
});
