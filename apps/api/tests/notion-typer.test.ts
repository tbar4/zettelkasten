// apps/api/tests/notion-typer.test.ts
import { describe, it, expect } from "vitest";
import { detectType } from "../src/notion/typer";

describe("detectType", () => {
  it("returns the explicit Type property when present", () => {
    const page = {
      properties: {
        Type: {
          type: "select",
          select: { name: "permanent" }
        }
      }
    };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 500 })).toBe(
      "permanent"
    );
  });

  it("uses 'literature' when a Source/Author/URL property is present", () => {
    const page = {
      properties: {
        Source: { type: "rich_text", rich_text: [{ plain_text: "Foucault" }] }
      }
    };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 100 })).toBe(
      "literature"
    );
  });

  it("uses 'topic' when a page is heavily linked to from other pages", () => {
    const page = { properties: {} };
    expect(detectType(page, { inboundMentions: 8, bodyLength: 50 })).toBe(
      "topic"
    );
  });

  it("uses 'permanent' for pages with substantive prose and no other signals", () => {
    const page = { properties: {} };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 800 })).toBe(
      "permanent"
    );
  });

  it("falls back to 'fleeting' for short, unlinked pages", () => {
    const page = { properties: {} };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 50 })).toBe(
      "fleeting"
    );
  });

  it("normalizes case on the explicit Type value", () => {
    const page = {
      properties: {
        Type: { type: "select", select: { name: "Topic" } }
      }
    };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 0 })).toBe(
      "topic"
    );
  });

  it("ignores an unknown explicit Type value and falls through", () => {
    const page = {
      properties: {
        Type: { type: "select", select: { name: "project" } }
      }
    };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 50 })).toBe(
      "fleeting"
    );
  });
});
