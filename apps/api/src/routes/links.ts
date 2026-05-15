import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { desc, eq, or } from "drizzle-orm";
import { NewNoteLinkSchema } from "@zk/shared";
import { db } from "../db/client";
import { noteLinks, notes } from "../db/schema";
import { notFound, conflict, badRequest } from "../lib/errors";
import { zodErrorHook } from "../lib/zod-error-hook";

export const linksRoute = new Hono();
export const noteLinksRoute = new Hono();

linksRoute.post("/", zValidator("json", NewNoteLinkSchema, zodErrorHook), async (c) => {
  const input = c.req.valid("json");

  const found = await db
    .select({ id: notes.id })
    .from(notes)
    .where(or(eq(notes.id, input.from_note_id), eq(notes.id, input.to_note_id)));
  const ids = new Set(found.map((r) => r.id));
  if (!ids.has(input.from_note_id)) throw notFound("note", input.from_note_id);
  if (!ids.has(input.to_note_id)) throw notFound("note", input.to_note_id);

  try {
    const [created] = await db
      .insert(noteLinks)
      .values({
        fromNoteId: input.from_note_id,
        toNoteId: input.to_note_id,
        linkType: input.link_type,
        context: input.context ?? null
      })
      .returning();
    return c.json(serializeLink(created!), 201);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("note_link_unique")
    ) {
      throw conflict("link already exists for that pair and type");
    }
    if (
      err instanceof Error &&
      err.message.includes("note_link_not_self")
    ) {
      throw badRequest("from and to must differ");
    }
    throw err;
  }
});

linksRoute.delete(
  "/:id",
  zValidator("param", z.object({ id: z.string().uuid() }), zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const result = await db
      .delete(noteLinks)
      .where(eq(noteLinks.id, id))
      .returning({ id: noteLinks.id });
    if (result.length === 0) throw notFound("link", id);
    return c.body(null, 204);
  }
);

noteLinksRoute.get(
  "/:id/links",
  zValidator("param", z.object({ id: z.string().uuid() }), zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const [exists] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.id, id));
    if (!exists) throw notFound("note", id);

    const outgoing = await db
      .select()
      .from(noteLinks)
      .where(eq(noteLinks.fromNoteId, id))
      .orderBy(desc(noteLinks.createdAt));
    const incoming = await db
      .select()
      .from(noteLinks)
      .where(eq(noteLinks.toNoteId, id))
      .orderBy(desc(noteLinks.createdAt));

    return c.json({
      outgoing: outgoing.map(serializeLink),
      incoming: incoming.map(serializeLink)
    });
  }
);

function serializeLink(row: typeof noteLinks.$inferSelect) {
  return {
    id: row.id,
    from_note_id: row.fromNoteId,
    to_note_id: row.toNoteId,
    link_type: row.linkType,
    context: row.context,
    created_at: row.createdAt.toISOString()
  };
}
