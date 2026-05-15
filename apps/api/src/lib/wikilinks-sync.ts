import { and, eq, inArray, isNull } from "drizzle-orm";
import { extractWikilinks } from "@zk/shared";
import type { db as DB } from "../db/client";
import { notes, noteLinks } from "../db/schema";

type DrizzleDB = typeof DB;

export async function syncWikilinks(
  db: DrizzleDB,
  fromNoteId: string,
  bodyMd: string | null
): Promise<void> {
  // Step 1: extract distinct target titles from body, excluding self-references.
  const wikilinks = bodyMd ? extractWikilinks(bodyMd) : [];
  const distinctTitles = Array.from(new Set(wikilinks.map((w) => w.title)));

  // Step 2: resolve titles → note IDs (first match wins for ambiguous titles).
  const matches =
    distinctTitles.length === 0
      ? []
      : await db
          .select({ id: notes.id, title: notes.title })
          .from(notes)
          .where(
            and(inArray(notes.title, distinctTitles), isNull(notes.archivedAt))
          );

  const titleToId = new Map<string, string>();
  for (const m of matches) {
    if (!titleToId.has(m.title)) titleToId.set(m.title, m.id);
  }

  const desiredTargets = new Set<string>();
  for (const title of distinctTitles) {
    const id = titleToId.get(title);
    if (id && id !== fromNoteId) desiredTargets.add(id);
  }

  // Step 3: fetch current wikilink rows for this note.
  const existing = await db
    .select({ id: noteLinks.id, toNoteId: noteLinks.toNoteId })
    .from(noteLinks)
    .where(
      and(eq(noteLinks.fromNoteId, fromNoteId), eq(noteLinks.source, "wikilink"))
    );

  const existingByTarget = new Map(existing.map((r) => [r.toNoteId, r.id]));
  const existingTargets = new Set(existing.map((r) => r.toNoteId));

  // Step 4: compute diff.
  const toInsert = [...desiredTargets].filter((t) => !existingTargets.has(t));
  const toDeleteIds = [...existingByTarget.entries()]
    .filter(([target]) => !desiredTargets.has(target))
    .map(([, id]) => id);

  // Step 5: apply in a transaction.
  await db.transaction(async (tx) => {
    if (toDeleteIds.length > 0) {
      await tx.delete(noteLinks).where(inArray(noteLinks.id, toDeleteIds));
    }
    if (toInsert.length > 0) {
      await tx.insert(noteLinks).values(
        toInsert.map((toNoteId) => ({
          fromNoteId,
          toNoteId,
          linkType: "references" as const,
          source: "wikilink" as const
        }))
      );
    }
  });
}
