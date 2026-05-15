import { describe, it, expect } from "vitest";
import { serialize } from "../src/frontmatter";

const fixedDate = new Date("2026-05-15T10:00:00.000Z");

describe("frontmatter.serialize", () => {
  it("serializes a permanent note with body, tags, and links", () => {
    const out = serialize({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "permanent",
      title: 'A Note: "Quoted"',
      bodyMd: "Body text.\n\nSecond paragraph.",
      tags: ["alpha", "beta"],
      links: [
        {
          toId: "550e8400-e29b-41d4-a716-446655440001",
          linkType: "supports",
          context: null
        }
      ],
      createdAt: fixedDate,
      updatedAt: fixedDate
    });
    expect(out).toContain('id: "550e8400-e29b-41d4-a716-446655440000"');
    expect(out).toContain("type: permanent");
    expect(out).toContain('title: "A Note: \\"Quoted\\""');
    expect(out).toContain("tags:");
    expect(out).toContain("  - alpha");
    expect(out).toContain("  - beta");
    expect(out).toContain("links:");
    expect(out).toContain("    to: 550e8400-e29b-41d4-a716-446655440001");
    expect(out).toContain("    type: supports");
    expect(out).toMatch(/---\n\nBody text\.\n\nSecond paragraph\./);
  });

  it("omits tags and links when empty", () => {
    const out = serialize({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "permanent",
      title: "Simple",
      bodyMd: "x",
      tags: [],
      links: [],
      createdAt: fixedDate,
      updatedAt: fixedDate
    });
    expect(out).not.toContain("tags:");
    expect(out).not.toContain("links:");
  });

  it("handles topic notes (no body)", () => {
    const out = serialize({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "topic",
      title: "Topic",
      bodyMd: null,
      tags: [],
      links: [],
      createdAt: fixedDate,
      updatedAt: fixedDate
    });
    // Topic notes have no body after the frontmatter, but the closing --- and
    // a trailing newline are still present.
    expect(out.endsWith("---\n")).toBe(true);
  });

  it("escapes control characters in quoted strings", () => {
    const out = serialize({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "permanent",
      title: "Line\nBreak\tTab\rCR",
      bodyMd: "x",
      tags: [],
      links: [],
      createdAt: new Date("2026-05-15T10:00:00.000Z"),
      updatedAt: new Date("2026-05-15T10:00:00.000Z")
    });
    expect(out).toContain('title: "Line\\nBreak\\tTab\\rCR"');
    expect(out).not.toMatch(/title: "[^"]*\n/);
  });
});
