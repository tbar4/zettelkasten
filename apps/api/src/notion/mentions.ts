const MENTION_RE = /\[\[notion:page:([^|\]]+)\|([^\]]+)\]\]/g;

export function extractMentionIds(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const id = m[1]?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function rewriteMentions(
  body: string,
  titleByPageId: Map<string, string>
): string {
  return body.replace(MENTION_RE, (_match, id, label) => {
    const idStr = (id as string).trim();
    const title = titleByPageId.get(idStr) ?? (label as string).trim();
    return `[[${title}]]`;
  });
}
