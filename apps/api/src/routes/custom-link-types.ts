import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { customLinkTypes } from "@zk/db-schema";
import { notFound, conflict } from "../lib/errors";
import { zodErrorHook } from "../lib/zod-error-hook";

export const customLinkTypesRoute = new Hono();

const idParam = z.object({ id: z.string().uuid() });

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional()
});

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional()
});

customLinkTypesRoute.get("/", async (c) => {
  const rows = await db.select().from(customLinkTypes);
  return c.json({ customLinkTypes: rows.map(serialize) });
});

customLinkTypesRoute.post(
  "/",
  zValidator("json", CreateSchema, zodErrorHook),
  async (c) => {
    const input = c.req.valid("json");
    try {
      const [created] = await db
        .insert(customLinkTypes)
        .values({ name: input.name, description: input.description ?? null })
        .returning();
      return c.json(serialize(created!), 201);
    } catch (err) {
      const pgErr = err as { code?: string; constraint_name?: string };
      if (
        pgErr.code === "23505" &&
        pgErr.constraint_name === "custom_link_type_name_unique"
      ) {
        throw conflict("custom link type name already exists");
      }
      if (pgErr.code === "23514") {
        throw conflict("name must not be empty");
      }
      throw err;
    }
  }
);

customLinkTypesRoute.patch(
  "/:id",
  zValidator("param", idParam, zodErrorHook),
  zValidator("json", UpdateSchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const [existing] = await db
      .select()
      .from(customLinkTypes)
      .where(eq(customLinkTypes.id, id));
    if (!existing) throw notFound("custom_link_type", id);

    const updates: Partial<typeof customLinkTypes.$inferInsert> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;

    try {
      const [updated] = await db
        .update(customLinkTypes)
        .set(updates)
        .where(eq(customLinkTypes.id, id))
        .returning();
      return c.json(serialize(updated!));
    } catch (err) {
      const pgErr = err as { code?: string; constraint_name?: string };
      if (
        pgErr.code === "23505" &&
        pgErr.constraint_name === "custom_link_type_name_unique"
      ) {
        throw conflict("custom link type name already exists");
      }
      throw err;
    }
  }
);

customLinkTypesRoute.delete(
  "/:id",
  zValidator("param", idParam, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const result = await db
      .delete(customLinkTypes)
      .where(eq(customLinkTypes.id, id))
      .returning({ id: customLinkTypes.id });
    if (result.length === 0) throw notFound("custom_link_type", id);
    return c.body(null, 204);
  }
);

function serialize(row: typeof customLinkTypes.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.createdAt.toISOString()
  };
}
