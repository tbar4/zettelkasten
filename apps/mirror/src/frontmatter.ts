export interface SerializeInput {
  id: string;
  type: "fleeting" | "literature" | "permanent" | "topic";
  title: string;
  bodyMd: string | null;
  tags: string[];
  links: Array<{
    toId: string;
    linkType: string;
    context: string | null;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

function quoteString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function serialize(input: SerializeInput): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${quoteString(input.id)}`);
  lines.push(`type: ${input.type}`);
  lines.push(`title: ${quoteString(input.title)}`);
  if (input.tags.length > 0) {
    lines.push("tags:");
    for (const t of input.tags) lines.push(`  - ${t}`);
  }
  if (input.links.length > 0) {
    lines.push("links:");
    for (const l of input.links) {
      lines.push("  - ");
      lines.push(`    to: ${l.toId}`);
      lines.push(`    type: ${l.linkType}`);
      if (l.context !== null) {
        lines.push(`    context: ${quoteString(l.context)}`);
      }
    }
  }
  lines.push(`created_at: ${input.createdAt.toISOString()}`);
  lines.push(`updated_at: ${input.updatedAt.toISOString()}`);
  lines.push("---");

  if (input.type === "topic" || input.bodyMd === null) {
    return lines.join("\n") + "\n";
  }
  // Add blank line between frontmatter and body
  return lines.join("\n") + "\n\n" + input.bodyMd + "\n";
}
