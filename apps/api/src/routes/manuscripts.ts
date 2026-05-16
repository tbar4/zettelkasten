import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, asc, inArray, sql, count } from "drizzle-orm";
import { db } from "../db/client";
import { manuscripts, manuscriptSections, notes } from "@zk/db-schema";
import { notFound, badRequest } from "../lib/errors";
import { zodErrorHook } from "../lib/zod-error-hook";

export const manuscriptsRoute = new Hono();

const uuidParam = z.object({ id: z.string().uuid() });
const sectionIdParam = z.object({ sectionId: z.string().uuid() });

const CreateManuscriptSchema = z.object({
  title: z.string().min(1),
  anchorTopicIds: z.array(z.string().uuid()).optional()
});

const PatchManuscriptSchema = z.object({
  title: z.string().min(1).optional(),
  anchorTopicIds: z.array(z.string().uuid()).optional(),
  bodyMd: z.string().nullable().optional()
});

const AddSectionSchema = z.object({
  position: z.number().int().optional(),
  noteId: z.string().uuid().nullable().optional(),
  isTransclusion: z.boolean().optional(),
  heading: z.string().nullable().optional(),
  frozenBodyMd: z.string().nullable().optional()
});

const PatchSectionSchema = z.object({
  position: z.number().int().optional(),
  heading: z.string().nullable().optional(),
  isTransclusion: z.boolean().optional(),
  frozenBodyMd: z.string().nullable().optional()
});

manuscriptsRoute.get("/", async (c) => {
  const rows = await db.select().from(manuscripts).orderBy(asc(manuscripts.createdAt));

  const manuscriptIds = rows.map((r) => r.id);
  const sectionCounts =
    manuscriptIds.length > 0
      ? await db
          .select({ manuscriptId: manuscriptSections.manuscriptId, cnt: count() })
          .from(manuscriptSections)
          .where(inArray(manuscriptSections.manuscriptId, manuscriptIds))
          .groupBy(manuscriptSections.manuscriptId)
      : [];

  const countMap = new Map(sectionCounts.map((r) => [r.manuscriptId, r.cnt]));

  return c.json({
    manuscripts: rows.map((r) => ({
      id: r.id,
      title: r.title,
      anchor_topic_ids: r.anchorTopicIds,
      anchor_count: r.anchorTopicIds.length,
      section_count: countMap.get(r.id) ?? 0,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString()
    }))
  });
});

manuscriptsRoute.post(
  "/",
  zValidator("json", CreateManuscriptSchema, zodErrorHook),
  async (c) => {
    const input = c.req.valid("json");
    const anchorTopicIds = input.anchorTopicIds ?? [];

    if (anchorTopicIds.length > 0) {
      await validateAnchorTopics(anchorTopicIds);
    }

    const [row] = await db
      .insert(manuscripts)
      .values({
        title: input.title,
        anchorTopicIds
      })
      .returning();

    return c.json(serializeManuscript(row!, []), 201);
  }
);

manuscriptsRoute.get(
  "/:id",
  zValidator("param", uuidParam, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");

    const [manuscript] = await db
      .select()
      .from(manuscripts)
      .where(eq(manuscripts.id, id));
    if (!manuscript) throw notFound("manuscript", id);

    const sections = await db
      .select({
        id: manuscriptSections.id,
        manuscriptId: manuscriptSections.manuscriptId,
        position: manuscriptSections.position,
        noteId: manuscriptSections.noteId,
        isTransclusion: manuscriptSections.isTransclusion,
        frozenBodyMd: manuscriptSections.frozenBodyMd,
        heading: manuscriptSections.heading,
        createdAt: manuscriptSections.createdAt,
        noteTitle: notes.title,
        noteBodyMd: notes.bodyMd
      })
      .from(manuscriptSections)
      .leftJoin(notes, eq(manuscriptSections.noteId, notes.id))
      .where(eq(manuscriptSections.manuscriptId, id))
      .orderBy(asc(manuscriptSections.position));

    return c.json(serializeManuscript(manuscript, sections));
  }
);

manuscriptsRoute.patch(
  "/:id",
  zValidator("param", uuidParam, zodErrorHook),
  zValidator("json", PatchManuscriptSchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const [existing] = await db
      .select({ id: manuscripts.id })
      .from(manuscripts)
      .where(eq(manuscripts.id, id));
    if (!existing) throw notFound("manuscript", id);

    if (input.anchorTopicIds && input.anchorTopicIds.length > 0) {
      await validateAnchorTopics(input.anchorTopicIds);
    }

    const updates: Partial<typeof manuscripts.$inferInsert> = {
      updatedAt: new Date()
    };
    if (input.title !== undefined) updates.title = input.title;
    if (input.anchorTopicIds !== undefined) updates.anchorTopicIds = input.anchorTopicIds;
    if (input.bodyMd !== undefined) updates.bodyMd = input.bodyMd;

    const [updated] = await db
      .update(manuscripts)
      .set(updates)
      .where(eq(manuscripts.id, id))
      .returning();

    const sections = await db
      .select({
        id: manuscriptSections.id,
        manuscriptId: manuscriptSections.manuscriptId,
        position: manuscriptSections.position,
        noteId: manuscriptSections.noteId,
        isTransclusion: manuscriptSections.isTransclusion,
        frozenBodyMd: manuscriptSections.frozenBodyMd,
        heading: manuscriptSections.heading,
        createdAt: manuscriptSections.createdAt,
        noteTitle: notes.title,
        noteBodyMd: notes.bodyMd
      })
      .from(manuscriptSections)
      .leftJoin(notes, eq(manuscriptSections.noteId, notes.id))
      .where(eq(manuscriptSections.manuscriptId, id))
      .orderBy(asc(manuscriptSections.position));

    return c.json(serializeManuscript(updated!, sections));
  }
);

manuscriptsRoute.delete(
  "/:id",
  zValidator("param", uuidParam, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const result = await db
      .delete(manuscripts)
      .where(eq(manuscripts.id, id))
      .returning({ id: manuscripts.id });
    if (result.length === 0) throw notFound("manuscript", id);
    return c.body(null, 204);
  }
);

manuscriptsRoute.post(
  "/:id/sections",
  zValidator("param", uuidParam, zodErrorHook),
  zValidator("json", AddSectionSchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const [manuscript] = await db
      .select({ id: manuscripts.id })
      .from(manuscripts)
      .where(eq(manuscripts.id, id));
    if (!manuscript) throw notFound("manuscript", id);

    let frozenBodyMd = input.frozenBodyMd ?? null;
    const isTransclusion = input.isTransclusion ?? true;

    if (input.noteId) {
      const [note] = await db
        .select({ bodyMd: notes.bodyMd })
        .from(notes)
        .where(eq(notes.id, input.noteId));
      if (!note) throw notFound("note", input.noteId);

      if (!isTransclusion && frozenBodyMd === null) {
        frozenBodyMd = note.bodyMd ?? null;
      }
    }

    let position = input.position ?? null;
    if (position === null) {
      position = await nextPosition(id);
    }

    const [section] = await db
      .insert(manuscriptSections)
      .values({
        manuscriptId: id,
        position,
        noteId: input.noteId ?? null,
        isTransclusion,
        frozenBodyMd,
        heading: input.heading ?? null
      })
      .returning();

    await db
      .update(manuscripts)
      .set({ updatedAt: new Date() })
      .where(eq(manuscripts.id, id));

    const noteInfo =
      input.noteId
        ? await db
            .select({ title: notes.title, bodyMd: notes.bodyMd })
            .from(notes)
            .where(eq(notes.id, input.noteId))
        : [];

    return c.json(
      serializeSection({
        ...section!,
        noteTitle: noteInfo[0]?.title ?? null,
        noteBodyMd: noteInfo[0]?.bodyMd ?? null
      }),
      201
    );
  }
);

manuscriptsRoute.patch(
  "/sections/:sectionId",
  zValidator("param", sectionIdParam, zodErrorHook),
  zValidator("json", PatchSectionSchema, zodErrorHook),
  async (c) => {
    const { sectionId } = c.req.valid("param");
    const input = c.req.valid("json");

    const [existing] = await db
      .select()
      .from(manuscriptSections)
      .where(eq(manuscriptSections.id, sectionId));
    if (!existing) throw notFound("manuscript_section", sectionId);

    const updates: Partial<typeof manuscriptSections.$inferInsert> = {};
    if (input.position !== undefined) {
      updates.position = input.position;
      await maybeRespace(existing.manuscriptId, input.position, sectionId);
    }
    if (input.heading !== undefined) updates.heading = input.heading;
    if (input.frozenBodyMd !== undefined) updates.frozenBodyMd = input.frozenBodyMd;

    if (input.isTransclusion !== undefined) {
      updates.isTransclusion = input.isTransclusion;
      if (!input.isTransclusion && existing.noteId) {
        const [note] = await db
          .select({ bodyMd: notes.bodyMd })
          .from(notes)
          .where(eq(notes.id, existing.noteId));
        if (note) {
          updates.frozenBodyMd = note.bodyMd ?? null;
        }
      } else if (input.isTransclusion) {
        updates.frozenBodyMd = null;
      }
    }

    const [updated] = await db
      .update(manuscriptSections)
      .set(updates)
      .where(eq(manuscriptSections.id, sectionId))
      .returning();

    await db
      .update(manuscripts)
      .set({ updatedAt: new Date() })
      .where(eq(manuscripts.id, existing.manuscriptId));

    const noteInfo =
      updated!.noteId
        ? await db
            .select({ title: notes.title, bodyMd: notes.bodyMd })
            .from(notes)
            .where(eq(notes.id, updated!.noteId))
        : [];

    return c.json(
      serializeSection({
        ...updated!,
        noteTitle: noteInfo[0]?.title ?? null,
        noteBodyMd: noteInfo[0]?.bodyMd ?? null
      })
    );
  }
);

manuscriptsRoute.delete(
  "/sections/:sectionId",
  zValidator("param", sectionIdParam, zodErrorHook),
  async (c) => {
    const { sectionId } = c.req.valid("param");

    const [existing] = await db
      .select({ id: manuscriptSections.id, manuscriptId: manuscriptSections.manuscriptId })
      .from(manuscriptSections)
      .where(eq(manuscriptSections.id, sectionId));
    if (!existing) throw notFound("manuscript_section", sectionId);

    await db.delete(manuscriptSections).where(eq(manuscriptSections.id, sectionId));
    await db
      .update(manuscripts)
      .set({ updatedAt: new Date() })
      .where(eq(manuscripts.id, existing.manuscriptId));

    return c.body(null, 204);
  }
);

async function validateAnchorTopics(ids: string[]) {
  const rows = await db
    .select({ id: notes.id, type: notes.type })
    .from(notes)
    .where(inArray(notes.id, ids));

  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length > 0) throw notFound("note", missing[0]!);

  const nonTopic = rows.filter((r) => r.type !== "topic");
  if (nonTopic.length > 0) {
    throw badRequest(`note ${nonTopic[0]!.id} is not a topic note`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextPosition(manuscriptId: string, dbOrTx: any = db): Promise<number> {
  const [row] = await dbOrTx
    .select({ maxPos: sql<number>`coalesce(max(${manuscriptSections.position}), 0)` })
    .from(manuscriptSections)
    .where(eq(manuscriptSections.manuscriptId, manuscriptId));
  return ((row?.maxPos ?? 0) as number) + 10;
}

async function maybeRespace(manuscriptId: string, newPosition: number, excludeSectionId: string) {
  const siblings = await db
    .select({ id: manuscriptSections.id, position: manuscriptSections.position })
    .from(manuscriptSections)
    .where(eq(manuscriptSections.manuscriptId, manuscriptId))
    .orderBy(asc(manuscriptSections.position));

  const others = siblings.filter((s) => s.id !== excludeSectionId);
  const conflicts = others.filter(
    (s) => Math.abs(s.position - newPosition) < 2
  );

  if (conflicts.length > 0) {
    const allWithNew = [...others, { id: excludeSectionId, position: newPosition }].sort(
      (a, b) => a.position - b.position
    );
    for (let i = 0; i < allWithNew.length; i++) {
      const entry = allWithNew[i]!;
      if (entry.id !== excludeSectionId) {
        await db
          .update(manuscriptSections)
          .set({ position: (i + 1) * 10 })
          .where(eq(manuscriptSections.id, entry.id));
      }
    }
  }
}

type SectionWithNote = typeof manuscriptSections.$inferSelect & {
  noteTitle: string | null;
  noteBodyMd: string | null;
};

type ManuscriptWithSections = typeof manuscripts.$inferSelect & {
  sections?: SectionWithNote[];
};

function serializeManuscript(
  manuscript: typeof manuscripts.$inferSelect,
  sections: SectionWithNote[]
) {
  return {
    id: manuscript.id,
    title: manuscript.title,
    anchor_topic_ids: manuscript.anchorTopicIds,
    body_md: manuscript.bodyMd,
    created_at: manuscript.createdAt.toISOString(),
    updated_at: manuscript.updatedAt.toISOString(),
    sections: sections.map(serializeSection)
  };
}

function serializeSection(section: SectionWithNote) {
  return {
    id: section.id,
    manuscript_id: section.manuscriptId,
    position: section.position,
    note_id: section.noteId,
    note_title: section.noteTitle,
    is_transclusion: section.isTransclusion,
    frozen_body_md: section.frozenBodyMd,
    heading: section.heading,
    body_md: section.isTransclusion ? section.noteBodyMd : section.frozenBodyMd,
    created_at: section.createdAt.toISOString()
  };
}
