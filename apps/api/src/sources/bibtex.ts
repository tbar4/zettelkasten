import { sources } from "@zk/db-schema";

type SourceRow = typeof sources.$inferSelect;

const SPECIAL_CHARS = /[\\{}%&#$_]/g;

function escapeBibtex(s: string): string {
  return s.replace(SPECIAL_CHARS, (ch) => `\\${ch}`);
}

function extractYear(title: string): string | null {
  const m = title.match(/(?:19|20)\d{2}/);
  return m?.[0] ?? null;
}

function lastnameFromAuthor(author: string): string {
  const words = author.trim().split(/\s+/);
  const last = words[words.length - 1] ?? author;
  return last.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function entryType(row: SourceRow): string {
  if (row.isbn) return "book";
  if (row.sourceType === "article") return "article";
  return "misc";
}

function citeKey(row: SourceRow): string {
  const prefix = row.author
    ? lastnameFromAuthor(row.author)
    : row.id.slice(0, 8);
  const year = extractYear(row.title) ?? "n.d.";
  return `${prefix}-${year}`;
}

export function sourcesToBibtex(rows: SourceRow[]): string {
  const entries = rows.map((row) => {
    const type = entryType(row);
    const key = citeKey(row);

    const fields: string[] = [`  title = {{${escapeBibtex(row.title)}}}`];

    if (row.author !== null) {
      fields.push(`  author = {${escapeBibtex(row.author)}}`);
    }

    const year = extractYear(row.title);
    if (year !== null) {
      fields.push(`  year = {${year}}`);
    }

    if (row.url !== null) {
      fields.push(`  url = {${escapeBibtex(row.url)}}`);
    }

    if (row.isbn !== null) {
      fields.push(`  isbn = {${escapeBibtex(row.isbn)}}`);
    }

    fields.push(`  note = {${row.id}}`);

    return `@${type}{${key},\n${fields.join(",\n")}\n}`;
  });

  return entries.join("\n\n");
}
