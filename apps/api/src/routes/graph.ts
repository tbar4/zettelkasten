import { Hono } from "hono";
import { isNull } from "drizzle-orm";
import { db } from "../db/client";
import { notes, noteLinks } from "@zk/db-schema";

export const graphRoute = new Hono();

graphRoute.get("/", async (c) => {
  const nodeRows = await db
    .select({
      id: notes.id,
      title: notes.title,
      type: notes.type
    })
    .from(notes)
    .where(isNull(notes.archivedAt));

  const aliveIds = new Set(nodeRows.map((n) => n.id));

  const edgeRows = await db
    .select({
      id: noteLinks.id,
      source: noteLinks.fromNoteId,
      target: noteLinks.toNoteId,
      link_type: noteLinks.linkType
    })
    .from(noteLinks);

  const edges = edgeRows.filter(
    (e) => aliveIds.has(e.source) && aliveIds.has(e.target)
  );

  return c.json({ nodes: nodeRows, edges });
});
