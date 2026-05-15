import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { NewNoteSchema, NoteType, UpdateNoteSchema } from "@zk/shared";
import { db } from "../db/client";
import { notes } from "../db/schema";
import { notFound, conflict, badRequest } from "../lib/errors";

export const notesRoute = new Hono();

const ListQuerySchema = z.object({
  type: NoteType.optional(),
  include_archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
});

notesRoute.get("/", zValidator("query", ListQuerySchema), async (c) => {
  const { type, include_archived } = c.req.valid("query");
  const where = and(
    type ? eq(notes.type, type) : undefined,
    include_archived ? undefined : isNull(notes.archivedAt)
  );
  const rows = await db
    .select()
    .from(notes)
    .where(where)
    .orderBy(desc(notes.createdAt));
  return c.json({ notes: rows.map(serializeNote) });
});

notesRoute.post("/", zValidator("json", NewNoteSchema), async (c) => {
  const input = c.req.valid("json");
  const [created] = await db
    .insert(notes)
    .values({
      type: input.type,
      title: input.title,
      bodyMd: input.body_md ?? null
    })
    .returning();
  return c.json(serializeNote(created!), 201);
});

const idParam = z.object({ id: z.string().uuid() });

notesRoute.get("/:id", zValidator("param", idParam), async (c) => {
  const { id } = c.req.valid("param");
  const [row] = await db.select().from(notes).where(eq(notes.id, id));
  if (!row) throw notFound("note", id);
  return c.json(serializeNote(row));
});

notesRoute.patch(
  "/:id",
  zValidator("param", idParam),
  zValidator("json", UpdateNoteSchema),
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

    if (existing.type === "topic" && update.body_md !== undefined) {
      throw badRequest("topic notes cannot have body_md");
    }

    const [updated] = await db
      .update(notes)
      .set({
        ...(update.title !== undefined ? { title: update.title } : {}),
        ...(update.type !== undefined ? { type: update.type } : {}),
        ...(update.body_md !== undefined ? { bodyMd: update.body_md } : {}),
        updatedAt: new Date()
      })
      .where(eq(notes.id, id))
      .returning();

    return c.json(serializeNote(updated!));
  }
);

notesRoute.delete("/:id", zValidator("param", idParam), async (c) => {
  const { id } = c.req.valid("param");
  const result = await db
    .update(notes)
    .set({ archivedAt: new Date() })
    .where(eq(notes.id, id))
    .returning({ id: notes.id });
  if (result.length === 0) throw notFound("note", id);
  return c.body(null, 204);
});

function serializeNote(row: typeof notes.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body_md: row.bodyMd,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
    notion_page_id: row.notionPageId
  };
}
