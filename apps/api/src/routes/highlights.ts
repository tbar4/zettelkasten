import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { notes } from "@zk/db-schema";
import { db } from "../db/client";
import { zodErrorHook } from "../lib/zod-error-hook";
import { notFound, conflict } from "../lib/errors";
import { promoteHighlight } from "../lib/promote-highlight";

export const highlightsRoute = new Hono();

const ParamSchema = z.object({ id: z.string().uuid() });
const BodySchema = z.object({ title: z.string().optional() });

highlightsRoute.post(
  "/:id/promote",
  zValidator("param", ParamSchema, zodErrorHook),
  zValidator("json", BodySchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const { title } = c.req.valid("json");

    const outcome = await promoteHighlight(db, {
      highlightId: id,
      titleOverride: title
    });

    if (!outcome.ok) {
      if (outcome.error.kind === "not_found") throw notFound("highlight", id);
      throw conflict(
        `highlight already promoted to note ${outcome.error.noteId}`
      );
    }

    const [row] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, outcome.result.noteId));
    if (!row) throw notFound("note", outcome.result.noteId);
    return c.json(
      {
        id: row.id,
        type: row.type,
        title: row.title,
        body_md: row.bodyMd,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString()
      },
      201
    );
  }
);
