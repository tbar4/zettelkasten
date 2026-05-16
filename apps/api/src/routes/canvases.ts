import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { notes, canvases, canvasItems, canvasEdges } from "@zk/db-schema";
import { notFound } from "../lib/errors";
import { zodErrorHook } from "../lib/zod-error-hook";

export const canvasesRoute = new Hono();

const uuidParam = z.object({ id: z.string().uuid() });
const itemIdParam = z.object({ itemId: z.string().uuid() });
const edgeIdParam = z.object({ edgeId: z.string().uuid() });
const topicNoteIdParam = z.object({ topicNoteId: z.string().uuid() });

const PatchCanvasSchema = z.object({
  scene_data: z.string().optional(),
  viewport: z.string().optional(),
  theme: z.string().optional()
});

const AddItemSchema = z.object({
  noteId: z.string().uuid(),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  color: z.string().optional()
});

const PatchItemSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  color: z.string().nullable().optional(),
  zIndex: z.number().int().optional()
});

const AddEdgeSchema = z.object({
  fromItemId: z.string().uuid(),
  toItemId: z.string().uuid(),
  label: z.string().optional(),
  color: z.string().optional()
});

canvasesRoute.get(
  "/by-topic/:topicNoteId",
  zValidator("param", topicNoteIdParam, zodErrorHook),
  async (c) => {
    const { topicNoteId } = c.req.valid("param");

    const [note] = await db
      .select({ id: notes.id, type: notes.type })
      .from(notes)
      .where(eq(notes.id, topicNoteId));
    if (!note) throw notFound("note", topicNoteId);
    if (note.type !== "topic") throw notFound("canvas", topicNoteId);

    const existing = await getOrCreateCanvas(topicNoteId);
    return c.json(existing);
  }
);

canvasesRoute.patch(
  "/:id",
  zValidator("param", uuidParam, zodErrorHook),
  zValidator("json", PatchCanvasSchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const [existing] = await db
      .select({ id: canvases.id })
      .from(canvases)
      .where(eq(canvases.id, id));
    if (!existing) throw notFound("canvas", id);

    const updates: Partial<typeof canvases.$inferInsert> = {
      updatedAt: new Date()
    };
    if (input.scene_data !== undefined) updates.sceneData = input.scene_data;
    if (input.viewport !== undefined) updates.viewport = input.viewport;
    if (input.theme !== undefined) updates.theme = input.theme;

    const [updated] = await db
      .update(canvases)
      .set(updates)
      .where(eq(canvases.id, id))
      .returning();
    return c.json(serializeCanvas(updated!, [], []));
  }
);

canvasesRoute.post(
  "/:id/items",
  zValidator("param", uuidParam, zodErrorHook),
  zValidator("json", AddItemSchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const [canvas] = await db
      .select({ id: canvases.id })
      .from(canvases)
      .where(eq(canvases.id, id));
    if (!canvas) throw notFound("canvas", id);

    const [item] = await db
      .insert(canvasItems)
      .values({
        canvasId: id,
        noteId: input.noteId,
        x: input.x,
        y: input.y,
        width: input.width ?? 200,
        height: input.height ?? 120,
        color: input.color ?? null
      })
      .returning();
    return c.json(serializeItem(item!), 201);
  }
);

canvasesRoute.patch(
  "/items/:itemId",
  zValidator("param", itemIdParam, zodErrorHook),
  zValidator("json", PatchItemSchema, zodErrorHook),
  async (c) => {
    const { itemId } = c.req.valid("param");
    const input = c.req.valid("json");

    const [existing] = await db
      .select({ id: canvasItems.id })
      .from(canvasItems)
      .where(eq(canvasItems.id, itemId));
    if (!existing) throw notFound("canvas_item", itemId);

    const updates: Partial<typeof canvasItems.$inferInsert> = {};
    if (input.x !== undefined) updates.x = input.x;
    if (input.y !== undefined) updates.y = input.y;
    if (input.width !== undefined) updates.width = input.width;
    if (input.height !== undefined) updates.height = input.height;
    if (input.color !== undefined) updates.color = input.color;
    if (input.zIndex !== undefined) updates.zIndex = input.zIndex;

    const [updated] = await db
      .update(canvasItems)
      .set(updates)
      .where(eq(canvasItems.id, itemId))
      .returning();
    return c.json(serializeItem(updated!));
  }
);

canvasesRoute.delete(
  "/items/:itemId",
  zValidator("param", itemIdParam, zodErrorHook),
  async (c) => {
    const { itemId } = c.req.valid("param");
    const result = await db
      .delete(canvasItems)
      .where(eq(canvasItems.id, itemId))
      .returning({ id: canvasItems.id });
    if (result.length === 0) throw notFound("canvas_item", itemId);
    return c.body(null, 204);
  }
);

canvasesRoute.post(
  "/:id/edges",
  zValidator("param", uuidParam, zodErrorHook),
  zValidator("json", AddEdgeSchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const [canvas] = await db
      .select({ id: canvases.id })
      .from(canvases)
      .where(eq(canvases.id, id));
    if (!canvas) throw notFound("canvas", id);

    const [edge] = await db
      .insert(canvasEdges)
      .values({
        canvasId: id,
        fromItemId: input.fromItemId,
        toItemId: input.toItemId,
        label: input.label ?? null,
        color: input.color ?? null
      })
      .returning();
    return c.json(serializeEdge(edge!), 201);
  }
);

canvasesRoute.delete(
  "/edges/:edgeId",
  zValidator("param", edgeIdParam, zodErrorHook),
  async (c) => {
    const { edgeId } = c.req.valid("param");
    const result = await db
      .delete(canvasEdges)
      .where(eq(canvasEdges.id, edgeId))
      .returning({ id: canvasEdges.id });
    if (result.length === 0) throw notFound("canvas_edge", edgeId);
    return c.body(null, 204);
  }
);

async function getOrCreateCanvas(topicNoteId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getOrCreateCanvasTx(db as any, topicNoteId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOrCreateCanvasTx(dbOrTx: any, topicNoteId: string) {
  const [existing] = await dbOrTx
    .select()
    .from(canvases)
    .where(eq(canvases.topicNoteId, topicNoteId));

  const canvas = existing ?? (await createCanvas(dbOrTx, topicNoteId));

  const items = await dbOrTx
    .select()
    .from(canvasItems)
    .where(eq(canvasItems.canvasId, canvas.id));

  const edges = await dbOrTx
    .select()
    .from(canvasEdges)
    .where(eq(canvasEdges.canvasId, canvas.id));

  return serializeCanvas(canvas, items, edges);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createCanvas(dbOrTx: any, topicNoteId: string) {
  const [created] = await dbOrTx
    .insert(canvases)
    .values({ topicNoteId })
    .returning();
  return created;
}

function serializeCanvas(
  canvas: typeof canvases.$inferSelect,
  items: (typeof canvasItems.$inferSelect)[],
  edges: (typeof canvasEdges.$inferSelect)[]
) {
  return {
    id: canvas.id,
    topic_note_id: canvas.topicNoteId,
    scene_data: canvas.sceneData,
    viewport: canvas.viewport,
    theme: canvas.theme,
    created_at: canvas.createdAt.toISOString(),
    updated_at: canvas.updatedAt.toISOString(),
    items: items.map(serializeItem),
    edges: edges.map(serializeEdge)
  };
}

function serializeItem(item: typeof canvasItems.$inferSelect) {
  return {
    id: item.id,
    canvas_id: item.canvasId,
    note_id: item.noteId,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    color: item.color,
    z_index: item.zIndex,
    created_at: item.createdAt.toISOString()
  };
}

function serializeEdge(edge: typeof canvasEdges.$inferSelect) {
  return {
    id: edge.id,
    canvas_id: edge.canvasId,
    from_item_id: edge.fromItemId,
    to_item_id: edge.toItemId,
    label: edge.label,
    color: edge.color,
    created_at: edge.createdAt.toISOString()
  };
}
