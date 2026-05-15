import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { NewNoteSchema, NoteType } from "@zk/shared";
import { db } from "../db/client";
import { notes } from "../db/schema";

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
