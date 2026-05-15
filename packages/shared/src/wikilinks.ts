export interface Wikilink {
  title: string;
  start: number;
  end: number;
}

export const WIKILINK_REGEX = /\[\[([^\[\]\n]+?)\]\]/g;

export function extractWikilinks(text: string): Wikilink[] {
  const results: Wikilink[] = [];
  const re = new RegExp(WIKILINK_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const inner = match[1];
    if (inner === undefined) continue;
    const title = inner.trim();
    if (title.length === 0) continue;
    results.push({
      title,
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return results;
}
