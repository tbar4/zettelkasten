import { eq } from "drizzle-orm";
import { highlights, notes, noteSources, sources } from "@zk/db-schema";

export interface PromoteInput {
  highlightId: string;
  titleOverride?: string;
}

export interface PromoteResult {
  noteId: string;
}

export type PromoteError =
  | { kind: "not_found" }
  | { kind: "already_promoted"; noteId: string };

export async function promoteHighlight(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: PromoteInput
): Promise<{ ok: true; result: PromoteResult } | { ok: false; error: PromoteError }> {
  return await db.transaction(async (tx: typeof db) => {
    const [highlight] = await tx
      .select()
      .from(highlights)
      .where(eq(highlights.id, input.highlightId));
    if (!highlight) return { ok: false, error: { kind: "not_found" } as const };
    if (highlight.promotedToNoteId) {
      return {
        ok: false,
        error: {
          kind: "already_promoted",
          noteId: highlight.promotedToNoteId
        } as const
      };
    }
    const [source] = await tx
      .select()
      .from(sources)
      .where(eq(sources.id, highlight.sourceId));
    if (!source) return { ok: false, error: { kind: "not_found" } as const };

    const defaultTitle =
      `${source.title}: ${highlight.text.slice(0, 60).trim()}`.slice(0, 200);
    const title = input.titleOverride ?? defaultTitle;

    const [note] = await tx
      .insert(notes)
      .values({
        type: "literature",
        title,
        bodyMd: highlight.text + (highlight.noteText ? `\n\n> ${highlight.noteText}` : "")
      })
      .returning();

    await tx
      .insert(noteSources)
      .values({ noteId: note!.id, sourceId: source.id });

    await tx
      .update(highlights)
      .set({ promotedToNoteId: note!.id })
      .where(eq(highlights.id, input.highlightId));

    return { ok: true, result: { noteId: note!.id } };
  });
}
