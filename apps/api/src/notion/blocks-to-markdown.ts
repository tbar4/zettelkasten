import type { NotionBlock } from "./client";

type RichTextItem = {
  plain_text?: string;
  type?: string;
  mention?: {
    type?: string;
    page?: { id?: string };
  };
};

function renderRichText(items: RichTextItem[] | undefined): string {
  if (!items) return "";
  return items
    .map((it) => {
      if (it.type === "mention" && it.mention?.type === "page") {
        const pageId = it.mention.page?.id ?? "";
        const label = it.plain_text ?? "";
        return `[[notion:page:${pageId}|${label}]]`;
      }
      return it.plain_text ?? "";
    })
    .join("");
}

export function blocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const type = (block as { type?: string }).type;
    switch (type) {
      case "paragraph": {
        const rt = (block as { paragraph?: { rich_text?: RichTextItem[] } })
          .paragraph?.rich_text;
        lines.push(renderRichText(rt));
        lines.push("");
        break;
      }
      case "heading_1":
      case "heading_2":
      case "heading_3": {
        const level = type === "heading_1" ? "#" : type === "heading_2" ? "##" : "###";
        const rt = (block as Record<string, { rich_text?: RichTextItem[] }>)[type]
          ?.rich_text;
        lines.push(`${level} ${renderRichText(rt)}`);
        lines.push("");
        break;
      }
      case "bulleted_list_item": {
        const rt = (block as { bulleted_list_item?: { rich_text?: RichTextItem[] } })
          .bulleted_list_item?.rich_text;
        lines.push(`- ${renderRichText(rt)}`);
        break;
      }
      case "numbered_list_item": {
        const rt = (block as { numbered_list_item?: { rich_text?: RichTextItem[] } })
          .numbered_list_item?.rich_text;
        lines.push(`1. ${renderRichText(rt)}`);
        break;
      }
      case "code": {
        const c = (block as {
          code?: { rich_text?: RichTextItem[]; language?: string };
        }).code;
        lines.push(`\`\`\`${c?.language ?? ""}`);
        lines.push(renderRichText(c?.rich_text));
        lines.push("```");
        lines.push("");
        break;
      }
      case "quote": {
        const rt = (block as { quote?: { rich_text?: RichTextItem[] } }).quote
          ?.rich_text;
        lines.push(`> ${renderRichText(rt)}`);
        lines.push("");
        break;
      }
      case "divider":
        lines.push("---");
        lines.push("");
        break;
      default:
        lines.push(`<!-- unsupported block: ${type} -->`);
        lines.push("");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
