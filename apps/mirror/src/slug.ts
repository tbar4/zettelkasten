export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // treat any non-alphanumeric, non-space, non-hyphen char as a word separator
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return base || "untitled";
}

export function fileNameFor(title: string, id: string): string {
  return `${slugify(title)}-${id.slice(0, 8)}.md`;
}
