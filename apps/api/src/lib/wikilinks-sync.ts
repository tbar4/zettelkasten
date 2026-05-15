import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { extractWikilinks } from "@zk/shared";
import type { db as DB } from "../db/client";
import { notes, noteLinks } from "../db/schema";

// Accept either the top-level db instance or a transaction handle (which lacks
// `$client` but shares all query-builder methods). Using a structural pick of
// the methods syncWikilinks actually calls lets both pass the type check.
type DrizzleDB = Pick<typeof DB, "select" | "insert" | "delete" | "transaction">;

export async function syncWikilinks(
  db: DrizzleDB,
  fromNoteId: string,
  bodyMd: string | null
): Promise<void> {
  // Step 1: extract distinct target titles from body, excluding self-references.
  const wikilinks = bodyMd ? extractWikilinks(bodyMd) : [];
  const distinctTitles = Array.from(new Set(wikilinks.map((w) => w.title)));

  // Step 2: resolve titles → note IDs (newest match wins for ambiguous titles).
  const lowerTitles = distinctTitles.map((t) => t.toLowerCase());
  const matches =
    lowerTitles.length === 0
      ? []
      : await db
          .select({ id: notes.id, title: notes.title })
          .from(notes)
          .where(
            and(
              inArray(sql<string>`lower(${notes.title})`, lowerTitles),
              isNull(notes.archivedAt)
            )
          )
          .orderBy(desc(notes.createdAt));

  const titleToId = new Map<string, string>();
  for (const m of matches) {
    const key = m.title.toLowerCase();
    if (!titleToId.has(key)) titleToId.set(key, m.id);
  }

  const desiredTargets = new Set<string>();
  for (const title of distinctTitles) {
    const id = titleToId.get(title.toLowerCase());
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
      await tx
        .insert(noteLinks)
        .values(
          toInsert.map((toNoteId) => ({
            fromNoteId,
            toNoteId,
            linkType: "references" as const,
            source: "wikilink" as const
          }))
        )
        .onConflictDoNothing({
          target: [noteLinks.fromNoteId, noteLinks.toNoteId, noteLinks.linkType]
        });
    }
  });
}
