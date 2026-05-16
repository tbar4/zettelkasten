import { describe, it, expect } from "vitest";
import { blocksToMarkdown } from "../src/notion/blocks-to-markdown";

function richText(text: string): { plain_text: string; href?: string }[] {
  return [{ plain_text: text }];
}

describe("blocksToMarkdown", () => {
  it("converts a paragraph", () => {
    const out = blocksToMarkdown([
      { type: "paragraph", paragraph: { rich_text: richText("Hello world") } }
    ]);
    expect(out.trim()).toBe("Hello world");
  });

  it("converts headings 1-3", () => {
    const out = blocksToMarkdown([
      { type: "heading_1", heading_1: { rich_text: richText("Big") } },
      { type: "heading_2", heading_2: { rich_text: richText("Med") } },
      { type: "heading_3", heading_3: { rich_text: richText("Small") } }
    ]);
    expect(out).toContain("# Big");
    expect(out).toContain("## Med");
    expect(out).toContain("### Small");
  });

  it("converts bulleted and numbered lists", () => {
    const out = blocksToMarkdown([
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText("A") }
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText("B") }
      },
      {
        type: "numbered_list_item",
        numbered_list_item: { rich_text: richText("First") }
      }
    ]);
    expect(out).toContain("- A");
    expect(out).toContain("- B");
    expect(out).toContain("1. First");
  });

  it("converts a fenced code block", () => {
    const out = blocksToMarkdown([
      {
        type: "code",
        code: {
          rich_text: richText("console.log('hi')"),
          language: "javascript"
        }
      }
    ]);
    expect(out).toContain("```javascript\nconsole.log('hi')\n```");
  });

  it("converts a quote", () => {
    const out = blocksToMarkdown([
      { type: "quote", quote: { rich_text: richText("Said someone") } }
    ]);
    expect(out).toContain("> Said someone");
  });

  it("emits a comment fallback for unsupported block types", () => {
    const out = blocksToMarkdown([
      { type: "image", image: { type: "external", external: { url: "x" } } }
    ]);
    expect(out).toContain("<!-- unsupported block: image -->");
  });

  it("preserves page mentions as inline tokens for later resolution", () => {
    const out = blocksToMarkdown([
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            { plain_text: "See " },
            {
              type: "mention",
              mention: {
                type: "page",
                page: { id: "abc-def-1234" }
              },
              plain_text: "Other Page"
            },
            { plain_text: " for more" }
          ]
        }
      }
    ]);
    expect(out).toContain("[[notion:page:abc-def-1234|Other Page]]");
  });
});
