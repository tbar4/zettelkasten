import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, asc, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { manuscripts, manuscriptSections, notes, noteSources, sources } from "@zk/db-schema";
import { notFound } from "../lib/errors";
import { zodErrorHook } from "../lib/zod-error-hook";
import { manuscriptToMarkdown, type ExportSection, type ExportSource } from "../manuscripts/export-md";
import { runPandoc, isPandocAvailable } from "../manuscripts/pandoc";

export const manuscriptExportsRoute = new Hono();

const uuidParam = z.object({ id: z.string().uuid() });
const formatQuery = z.object({ format: z.enum(["md", "latex", "docx"]) });

/** Kebab-case a title for use as a filename slug. */
function titleToSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "manuscript";
}

manuscriptExportsRoute.get(
  "/:id/export",
  zValidator("param", uuidParam, zodErrorHook),
  zValidator("query", formatQuery, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const { format } = c.req.valid("query");

    // 503 early if latex/docx requested and pandoc is absent
    if (format === "latex" || format === "docx") {
      const available = await isPandocAvailable();
      if (!available) {
        return c.json({ error: "Pandoc not installed" }, 503);
      }
    }

    // Load manuscript
    const [manuscript] = await db
      .select()
      .from(manuscripts)
      .where(eq(manuscripts.id, id));
    if (!manuscript) throw notFound("manuscript", id);

    // Load sections with note info
    const sectionRows = await db
      .select({
        id: manuscriptSections.id,
        position: manuscriptSections.position,
        heading: manuscriptSections.heading,
        noteId: manuscriptSections.noteId,
        isTransclusion: manuscriptSections.isTransclusion,
        frozenBodyMd: manuscriptSections.frozenBodyMd,
        noteTitle: notes.title,
        noteBodyMd: notes.bodyMd
      })
      .from(manuscriptSections)
      .leftJoin(notes, eq(manuscriptSections.noteId, notes.id))
      .where(eq(manuscriptSections.manuscriptId, id))
      .orderBy(asc(manuscriptSections.position));

    // Collect unique note IDs that have linked notes
    const noteIds = sectionRows
      .map((s) => s.noteId)
      .filter((nid): nid is string => nid !== null);

    // Load note_source rows for all referenced notes
    const noteSourceRows =
      noteIds.length > 0
        ? await db
            .select({ noteId: noteSources.noteId, sourceId: noteSources.sourceId })
            .from(noteSources)
            .where(inArray(noteSources.noteId, noteIds))
        : [];

    // Collect unique source IDs
    const sourceIds = [...new Set(noteSourceRows.map((r) => r.sourceId))];

    // Load source details
    const sourceRows =
      sourceIds.length > 0
        ? await db
            .select({
              id: sources.id,
              title: sources.title,
              author: sources.author
            })
            .from(sources)
            .where(inArray(sources.id, sourceIds))
        : [];

    // Build lookup maps
    const noteByIdMap = new Map<string, { sources: string[] }>();
    for (const ns of noteSourceRows) {
      const existing = noteByIdMap.get(ns.noteId);
      if (existing) {
        existing.sources.push(ns.sourceId);
      } else {
        noteByIdMap.set(ns.noteId, { sources: [ns.sourceId] });
      }
    }

    const sourceByIdMap = new Map<string, ExportSource>();
    for (const src of sourceRows) {
      sourceByIdMap.set(src.id, {
        id: src.id,
        title: src.title,
        author: src.author
      });
    }

    const sections: ExportSection[] = sectionRows.map((s) => ({
      id: s.id,
      position: s.position,
      heading: s.heading,
      noteId: s.noteId,
      noteTitle: s.noteTitle ?? null,
      isTransclusion: s.isTransclusion,
      frozenBodyMd: s.frozenBodyMd,
      noteBodyMd: s.noteBodyMd ?? null
    }));

    // Assemble markdown
    const mdText = manuscriptToMarkdown(
      { title: manuscript.title, bodyMd: manuscript.bodyMd },
      sections,
      noteByIdMap,
      sourceByIdMap
    );

    const slug = titleToSlug(manuscript.title);

    if (format === "md") {
      return c.body(mdText, 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}.md"`
      });
    }

    if (format === "latex") {
      const buf = await runPandoc(mdText, [
        "-f", "markdown",
        "-t", "latex",
        "--standalone"
      ]);
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/x-tex",
          "Content-Disposition": `attachment; filename="${slug}.tex"`
        }
      });
    }

    // format === "docx"
    const buf = await runPandoc(mdText, ["-f", "markdown", "-t", "docx"]);
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${slug}.docx"`
      }
    });
  }
);
