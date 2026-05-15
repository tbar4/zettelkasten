import { readdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray, isNull } from "drizzle-orm";
import { notes, noteLinks, noteTags, tags } from "./schema-mirror";
import { fileNameFor } from "./slug";
import { serialize } from "./frontmatter";
import { openOrInitRepo, commitAll } from "./git";

export interface SweepResult {
  written: number;
  deleted: number;
  committed: boolean;
}

export async function runSweep(
  databaseUrl: string,
  mirrorDir: string
): Promise<SweepResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const schema = { notes, noteLinks, noteTags, tags };
    const db = drizzle(sql, { schema });

    // 1. Snapshot desired state from DB.
    const noteRows = await db
      .select()
      .from(notes)
      .where(isNull(notes.archivedAt));
    const ids = noteRows.map((n) => n.id);

    const tagRows =
      ids.length === 0
        ? []
        : await db
            .select({ noteId: noteTags.noteId, name: tags.name })
            .from(noteTags)
            .innerJoin(tags, eq(tags.id, noteTags.tagId))
            .where(inArray(noteTags.noteId, ids));
    const tagsByNote = new Map<string, string[]>();
    for (const r of tagRows) {
      const existing = tagsByNote.get(r.noteId);
      if (existing) existing.push(r.name);
      else tagsByNote.set(r.noteId, [r.name]);
    }

    const linkRows =
      ids.length === 0
        ? []
        : await db
            .select({
              fromId: noteLinks.fromNoteId,
              toId: noteLinks.toNoteId,
              linkType: noteLinks.linkType,
              context: noteLinks.context
            })
            .from(noteLinks)
            .where(inArray(noteLinks.fromNoteId, ids));
    const linksByNote = new Map<
      string,
      { toId: string; linkType: string; context: string | null }[]
    >();
    for (const l of linkRows) {
      const existing = linksByNote.get(l.fromId);
      const entry = { toId: l.toId, linkType: l.linkType, context: l.context };
      if (existing) existing.push(entry);
      else linksByNote.set(l.fromId, [entry]);
    }

    // 2. Compute desired filenames + contents.
    const desired = new Map<string, string>();
    for (const n of noteRows) {
      const name = fileNameFor(n.title, n.id);
      const content = serialize({
        id: n.id,
        type: n.type,
        title: n.title,
        bodyMd: n.bodyMd,
        tags: (tagsByNote.get(n.id) ?? []).sort(),
        links: linksByNote.get(n.id) ?? [],
        createdAt: n.createdAt,
        updatedAt: n.updatedAt
      });
      desired.set(name, content);
    }

    // 3. Ensure the mirror dir is a git repo.
    const git = await openOrInitRepo(mirrorDir);

    // 4. Walk current files; compute writes and deletes.
    const existing = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    let written = 0;
    let deleted = 0;

    for (const [name, content] of desired) {
      await writeFile(join(mirrorDir, name), content, "utf8");
      written++;
    }
    for (const f of existing) {
      if (!desired.has(f)) {
        await unlink(join(mirrorDir, f));
        deleted++;
      }
    }

    // 5. Commit if anything changed.
    const summary = `zk: sweep (${written} notes, ${deleted} deletions)`;
    const committed = await commitAll(git, summary);

    return { written, deleted, committed };
  } finally {
    await sql.end();
  }
}
