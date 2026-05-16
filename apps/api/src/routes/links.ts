import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { desc, eq, or } from "drizzle-orm";
import { NewNoteLinkSchema } from "@zk/shared";
import { db } from "../db/client";
import { noteLinks, notes, customLinkTypes } from "@zk/db-schema";
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

  if (input.custom_link_type_id) {
    const [clt] = await db
      .select({ id: customLinkTypes.id })
      .from(customLinkTypes)
      .where(eq(customLinkTypes.id, input.custom_link_type_id));
    if (!clt) throw badRequest(`custom_link_type_id ${input.custom_link_type_id} not found`);
  }

  try {
    const [created] = await db
      .insert(noteLinks)
      .values({
        fromNoteId: input.from_note_id,
        toNoteId: input.to_note_id,
        linkType: input.link_type,
        context: input.context ?? null,
        customLinkTypeId: input.custom_link_type_id ?? null,
        source: "manual"
      })
      .returning();

    const customTypeName = input.custom_link_type_id
      ? await db
          .select({ name: customLinkTypes.name })
          .from(customLinkTypes)
          .where(eq(customLinkTypes.id, input.custom_link_type_id))
          .then((rows) => rows[0]?.name ?? null)
      : null;

    return c.json(serializeLink(created!, customTypeName), 201);
  } catch (err) {
    const pgErr = err as { code?: string; constraint_name?: string };
    if (pgErr.code === "23505" && pgErr.constraint_name === "note_link_unique") {
      throw conflict("link already exists for that pair and type");
    }
    if (
      pgErr.code === "23514" &&
      pgErr.constraint_name === "note_link_not_self"
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
      .select({
        link: noteLinks,
        customTypeName: customLinkTypes.name
      })
      .from(noteLinks)
      .leftJoin(customLinkTypes, eq(noteLinks.customLinkTypeId, customLinkTypes.id))
      .where(eq(noteLinks.fromNoteId, id))
      .orderBy(desc(noteLinks.createdAt));
    const incoming = await db
      .select({
        link: noteLinks,
        customTypeName: customLinkTypes.name
      })
      .from(noteLinks)
      .leftJoin(customLinkTypes, eq(noteLinks.customLinkTypeId, customLinkTypes.id))
      .where(eq(noteLinks.toNoteId, id))
      .orderBy(desc(noteLinks.createdAt));

    return c.json({
      outgoing: outgoing.map((r) => serializeLink(r.link, r.customTypeName ?? null)),
      incoming: incoming.map((r) => serializeLink(r.link, r.customTypeName ?? null))
    });
  }
);

function serializeLink(
  row: typeof noteLinks.$inferSelect,
  customTypeName: string | null = null
) {
  return {
    id: row.id,
    from_note_id: row.fromNoteId,
    to_note_id: row.toNoteId,
    link_type: row.linkType,
    context: row.context,
    source: row.source,
    custom_link_type_id: row.customLinkTypeId ?? null,
    custom_link_type_name: customTypeName,
    created_at: row.createdAt.toISOString()
  };
}
