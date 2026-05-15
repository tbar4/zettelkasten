import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notes, noteTags, tags } from "../db/schema";
import { notFound } from "../lib/errors";
import { zodErrorHook } from "../lib/zod-error-hook";

const TagName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "tag must be lowercase kebab-case");

export const tagsRoute = new Hono();
export const noteTagsRoute = new Hono();

tagsRoute.get("/", async (c) => {
  const rows = await db
    .select({
      name: tags.name,
      count: sql<number>`count(${noteTags.tagId})::int`
    })
    .from(tags)
    .leftJoin(noteTags, eq(noteTags.tagId, tags.id))
    .groupBy(tags.id, tags.name)
    .orderBy(tags.name);
  return c.json({ tags: rows });
});

noteTagsRoute.put(
  "/:id/tags",
  zValidator("param", z.object({ id: z.string().uuid() }), zodErrorHook),
  zValidator("json", z.object({ tags: z.array(TagName) }), zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const { tags: tagNames } = c.req.valid("json");

    const [note] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(eq(notes.id, id));
    if (!note) throw notFound("note", id);

    await db.transaction(async (tx) => {
      // Upsert tags by name.
      if (tagNames.length > 0) {
        await tx
          .insert(tags)
          .values(tagNames.map((name) => ({ name })))
          .onConflictDoNothing({ target: tags.name });
      }

      const existing = tagNames.length
        ? await tx
            .select({ id: tags.id, name: tags.name })
            .from(tags)
            .where(inArray(tags.name, tagNames))
        : [];

      await tx.delete(noteTags).where(eq(noteTags.noteId, id));
      if (existing.length > 0) {
        await tx
          .insert(noteTags)
          .values(existing.map((t) => ({ noteId: id, tagId: t.id })));
      }
    });

    return c.json({ tags: tagNames });
  }
);
