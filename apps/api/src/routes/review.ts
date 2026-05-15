import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/client";
import { zodErrorHook } from "../lib/zod-error-hook";
import { notFound } from "../lib/errors";
import { applyKeep, applyArchive } from "../lib/spaced-review";

export const reviewRoute = new Hono();

const ParamSchema = z.object({ id: z.string().uuid() });
const ActionSchema = z.object({ action: z.enum(["keep", "archive"]) });

reviewRoute.post(
  "/:id/review",
  zValidator("param", ParamSchema, zodErrorHook),
  zValidator("json", ActionSchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const { action } = c.req.valid("json");

    if (action === "archive") {
      const archived = await applyArchive(db, id);
      if (!archived) throw notFound("note", id);
      return c.body(null, 204);
    }

    const updated = await applyKeep(db, id);
    if (!updated) throw notFound("note", id);
    return c.json({
      interval_days: updated.intervalDays,
      next_due_at: updated.nextDueAt.toISOString()
    });
  }
);
