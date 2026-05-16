/**
 * Markdown serializer for manuscript export.
 *
 * Citation key format: <firstname-of-author-lowercased>-<year-if-extractable> or
 * source.id.slice(0,8) as fallback. Deliberately simple – BibTeX deferred to M3.
 */

export interface ExportSection {
  id: string;
  position: number;
  heading: string | null;
  noteId: string | null;
  noteTitle: string | null;
  isTransclusion: boolean;
  frozenBodyMd: string | null;
  noteBodyMd: string | null;
}

export interface ExportSource {
  id: string;
  title: string;
  author: string | null;
}

export interface ExportManuscript {
  title: string;
  bodyMd: string | null;
}

/**
 * Build a citation key from a source.
 * E.g. author="John Smith" year in title or url → "smith-2019"
 * Fallback: first 8 chars of source.id.
 */
function sourceCitationKey(source: ExportSource): string {
  if (source.author) {
    const words = source.author.trim().split(/\s+/);
    // Use the last word of the author name as a simple lastname approximation
    const lastWord = words[words.length - 1];
    if (lastWord) {
      const lastName = lastWord.toLowerCase().replace(/[^a-z]/g, "");
      // Try to extract a 4-digit year from the title
      const yearMatch = source.title.match(/\b(1[89]\d\d|20\d\d)\b/);
      const year = yearMatch ? yearMatch[1]! : null;
      const key = year ? `${lastName}-${year}` : lastName;
      if (key) return key;
    }
  }
  return source.id.slice(0, 8);
}

/**
 * Serialize a manuscript to a Markdown string suitable for export.
 *
 * @param manuscript  Manuscript metadata (title, bodyMd)
 * @param sections    Sections ordered by position
 * @param noteByIdMap Map noteId → { sources: source[] } listing note_source entries
 * @param sourceByIdMap Map sourceId → ExportSource
 */
export function manuscriptToMarkdown(
  manuscript: ExportManuscript,
  sections: ExportSection[],
  noteByIdMap: Map<string, { sources: string[] }>, // sourceIds
  sourceByIdMap: Map<string, ExportSource>
): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${manuscript.title}`);

  // Optional body intro
  if (manuscript.bodyMd) {
    lines.push("");
    lines.push(manuscript.bodyMd.trim());
  }

  // Track all referenced source ids across all sections, in encounter order
  const allSourceIds: string[] = [];
  const seenSourceIds = new Set<string>();

  // Sections
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    lines.push("");

    // Heading: explicit heading > note title > "Section N"
    const sectionHeading =
      section.heading?.trim() ||
      section.noteTitle?.trim() ||
      `Section ${i + 1}`;
    lines.push(`## ${sectionHeading}`);
    lines.push("");

    // Body: transclusion uses live note body; copy uses frozen
    const body = section.isTransclusion ? section.noteBodyMd : section.frozenBodyMd;
    if (body) {
      lines.push(body.trim());
    }

    // Inline citations for sources linked to this section's note
    if (section.noteId) {
      const noteInfo = noteByIdMap.get(section.noteId);
      if (noteInfo && noteInfo.sources.length > 0) {
        const citeKeys = noteInfo.sources
          .map((sid) => {
            const src = sourceByIdMap.get(sid);
            return src ? `[@${sourceCitationKey(src)}]` : null;
          })
          .filter(Boolean) as string[];

        if (citeKeys.length > 0) {
          lines.push("");
          lines.push(citeKeys.join(" "));
        }

        // Record for references section
        for (const sid of noteInfo.sources) {
          if (!seenSourceIds.has(sid)) {
            seenSourceIds.add(sid);
            allSourceIds.push(sid);
          }
        }
      }
    }
  }

  // References section
  if (allSourceIds.length > 0) {
    lines.push("");
    lines.push("## References");
    lines.push("");
    for (const sid of allSourceIds) {
      const src = sourceByIdMap.get(sid);
      if (src) {
        const key = sourceCitationKey(src);
        const authorPart = src.author ? ` by ${src.author}` : "";
        lines.push(`- [@${key}] ${src.title}${authorPart}`);
      }
    }
  }

  return lines.join("\n");
}
