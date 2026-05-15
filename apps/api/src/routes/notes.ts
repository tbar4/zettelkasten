import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { NewNoteSchema, NoteType, UpdateNoteSchema } from "@zk/shared";
import { db } from "../db/client";
import { notes, noteTags, tags, noteSources, sources } from "@zk/db-schema";
import { notFound, conflict, badRequest } from "../lib/errors";
import { zodErrorHook } from "../lib/zod-error-hook";
import { syncWikilinks } from "../lib/wikilinks-sync";
import { scheduleReview } from "../lib/spaced-review";

export const notesRoute = new Hono();

const ListQuerySchema = z.object({
  type: NoteType.optional(),
  ids: z.string().optional(),
  fields: z.string().optional(),
  include_archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
});

notesRoute.get("/", zValidator("query", ListQuerySchema, zodErrorHook), async (c) => {
  const { type, ids, fields, include_archived } = c.req.valid("query");
  if (ids !== undefined) {
    const idList = ids
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (idList.length === 0) return c.json({ notes: [] });

    if (fields === "id,title,type") {
      const rows = await db
        .select({ id: notes.id, title: notes.title, type: notes.type })
        .from(notes)
        .where(inArray(notes.id, idList));
      return c.json({ notes: rows });
    }

    const rows = await db
      .select()
      .from(notes)
      .where(inArray(notes.id, idList))
      .orderBy(desc(notes.createdAt));
    const tagsByNote = await fetchTagsFor(rows.map((r) => r.id));
    const sourcesByNote = await fetchSourcesFor(rows.map((r) => r.id));
    return c.json({
      notes: rows.map((r) =>
        serializeNote(r, tagsByNote.get(r.id) ?? [], sourcesByNote.get(r.id) ?? [])
      )
    });
  }
  const where = and(
    type ? eq(notes.type, type) : undefined,
    include_archived ? undefined : isNull(notes.archivedAt)
  );
  const rows = await db
    .select()
    .from(notes)
    .where(where)
    .orderBy(desc(notes.createdAt));
  const tagsByNote = await fetchTagsFor(rows.map((r) => r.id));
  const sourcesByNote = await fetchSourcesFor(rows.map((r) => r.id));
  return c.json({
    notes: rows.map((r) =>
      serializeNote(r, tagsByNote.get(r.id) ?? [], sourcesByNote.get(r.id) ?? [])
    )
  });
});

notesRoute.post("/", zValidator("json", NewNoteSchema, zodErrorHook), async (c) => {
  const input = c.req.valid("json");
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(notes)
      .values({
        type: input.type,
        title: input.title,
        bodyMd: input.body_md ?? null
      })
      .returning();
    await syncWikilinks(tx, row!.id, row!.bodyMd);
    if (row!.type === "permanent") {
      await scheduleReview(tx, row!.id);
    }
    return row!;
  });
  return c.json(serializeNote(created, [], []), 201);
});

const SearchQuerySchema = z.object({ q: z.string().default("") });

notesRoute.get("/search", zValidator("query", SearchQuerySchema, zodErrorHook), async (c) => {
  const { q } = c.req.valid("query");
  const trimmed = q.trim();

  if (trimmed.length === 0) {
    const rows = await db
      .select({ id: notes.id, title: notes.title, type: notes.type })
      .from(notes)
      .where(isNull(notes.archivedAt))
      .orderBy(desc(notes.updatedAt))
      .limit(10);
    return c.json({ notes: rows });
  }

  const tsQuery = sql`websearch_to_tsquery('english', ${trimmed})`;
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      type: notes.type,
      rank: sql<number>`ts_rank(${notes.tsv}, ${tsQuery})`.as("rank")
    })
    .from(notes)
    .where(
      and(sql`${notes.tsv} @@ ${tsQuery}`, isNull(notes.archivedAt))
    )
    .orderBy(sql`rank DESC`, desc(notes.updatedAt))
    .limit(10);
  return c.json({ notes: rows.map(({ rank, ...rest }) => rest) });
});

const idParam = z.object({ id: z.string().uuid() });

notesRoute.get("/:id", zValidator("param", idParam, zodErrorHook), async (c) => {
  const { id } = c.req.valid("param");
  const [row] = await db.select().from(notes).where(eq(notes.id, id));
  if (!row) throw notFound("note", id);
  const tagsByNote = await fetchTagsFor([id]);
  const sourcesByNote = await fetchSourcesFor([id]);
  return c.json(
    serializeNote(row, tagsByNote.get(id) ?? [], sourcesByNote.get(id) ?? [])
  );
});

notesRoute.patch(
  "/:id",
  zValidator("param", idParam, zodErrorHook),
  zValidator("json", UpdateNoteSchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const update = c.req.valid("json");
    const ifMatch = c.req.header("if-match");
    if (!ifMatch) throw badRequest("If-Match header required");

    const [existing] = await db.select().from(notes).where(eq(notes.id, id));
    if (!existing) throw notFound("note", id);
    if (existing.updatedAt.toISOString() !== ifMatch) {
      throw conflict("note has been modified by another writer");
    }

    // Compute effective post-update state and reject any (type=topic, body_md non-null) combination.
    const effectiveType = update.type ?? existing.type;
    const effectiveBodyMd =
      update.body_md !== undefined ? update.body_md : existing.bodyMd;
    if (effectiveType === "topic" && effectiveBodyMd !== null) {
      throw badRequest(
        "topic notes cannot have body_md; send body_md: null when converting"
      );
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(notes)
        .set({
          ...(update.title !== undefined ? { title: update.title } : {}),
          ...(update.type !== undefined ? { type: update.type } : {}),
          ...(update.body_md !== undefined ? { bodyMd: update.body_md } : {}),
          updatedAt: new Date()
        })
        .where(eq(notes.id, id))
        .returning();
      if (update.body_md !== undefined) {
        await syncWikilinks(tx, id, row!.bodyMd);
      }
      if (update.type === "permanent" && existing.type !== "permanent") {
        await scheduleReview(tx, id);
      }
      return row!;
    });

    const tagsByNote = await fetchTagsFor([id]);
    const sourcesByNote = await fetchSourcesFor([id]);
    return c.json(
      serializeNote(updated, tagsByNote.get(id) ?? [], sourcesByNote.get(id) ?? [])
    );
  }
);

notesRoute.delete("/:id", zValidator("param", idParam, zodErrorHook), async (c) => {
  const { id } = c.req.valid("param");
  const result = await db
    .update(notes)
    .set({ archivedAt: new Date() })
    .where(eq(notes.id, id))
    .returning({ id: notes.id });
  if (result.length === 0) throw notFound("note", id);
  return c.body(null, 204);
});

async function fetchTagsFor(noteIds: string[]): Promise<Map<string, string[]>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db
    .select({ noteId: noteTags.noteId, name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(inArray(noteTags.noteId, noteIds));
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const existing = map.get(r.noteId);
    if (existing) existing.push(r.name);
    else map.set(r.noteId, [r.name]);
  }
  return map;
}

async function fetchSourcesFor(
  noteIds: string[]
): Promise<Map<string, { id: string; title: string; author: string | null; url: string | null }[]>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db
    .select({
      noteId: noteSources.noteId,
      id: sources.id,
      title: sources.title,
      author: sources.author,
      url: sources.url
    })
    .from(noteSources)
    .innerJoin(sources, eq(sources.id, noteSources.sourceId))
    .where(inArray(noteSources.noteId, noteIds));
  const map = new Map<string, { id: string; title: string; author: string | null; url: string | null }[]>();
  for (const r of rows) {
    const existing = map.get(r.noteId);
    const entry = { id: r.id, title: r.title, author: r.author, url: r.url };
    if (existing) existing.push(entry);
    else map.set(r.noteId, [entry]);
  }
  return map;
}

function serializeNote(
  row: typeof notes.$inferSelect,
  tagNames: string[] = [],
  sourcesList: { id: string; title: string; author: string | null; url: string | null }[] = []
) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body_md: row.bodyMd,
    tags: tagNames.sort(),
    sources: sourcesList,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
    notion_page_id: row.notionPageId
  };
}
