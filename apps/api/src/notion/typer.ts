import type { NotionPage } from "./client";

export type NoteType = "fleeting" | "literature" | "permanent" | "topic";

export interface TypeSignals {
  inboundMentions: number;
  bodyLength: number;
}

const VALID_TYPES: ReadonlySet<NoteType> = new Set([
  "fleeting",
  "literature",
  "permanent",
  "topic"
]);

const TOPIC_MENTION_THRESHOLD = 5;
const PROSE_BODY_THRESHOLD = 400;

function selectName(prop: unknown): string | null {
  if (!prop || typeof prop !== "object") return null;
  const p = prop as { type?: string; select?: { name?: string } | null };
  if (p.type === "select" && p.select?.name) return p.select.name;
  return null;
}

export function detectType(page: NotionPage, signals: TypeSignals): NoteType {
  const properties = (page?.properties ?? {}) as Record<string, unknown>;

  // 1. Explicit Type property wins, if recognized.
  const explicit = selectName(properties.Type);
  if (explicit) {
    const normalized = explicit.toLowerCase();
    if (VALID_TYPES.has(normalized as NoteType)) return normalized as NoteType;
  }

  // 2. Source/Author/URL property → literature.
  if (properties.Source || properties.Author || properties.URL) {
    return "literature";
  }

  // 3. Heavily linked-to → topic.
  if (signals.inboundMentions >= TOPIC_MENTION_THRESHOLD) return "topic";

  // 4. Substantive prose → permanent.
  if (signals.bodyLength >= PROSE_BODY_THRESHOLD) return "permanent";

  // 5. Otherwise fleeting.
  return "fleeting";
}
