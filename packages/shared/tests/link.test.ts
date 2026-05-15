import { describe, it, expect } from "vitest";
import { LinkType, NewNoteLinkSchema } from "../src/link";

describe("LinkType", () => {
  it("accepts the eight starter types", () => {
    const types = [
      "references",
      "elaborates",
      "supports",
      "contradicts",
      "example_of",
      "defines",
      "questions",
      "derived_from"
    ];
    for (const t of types) expect(LinkType.parse(t)).toBe(t);
  });

  it("rejects unknown types", () => {
    expect(() => LinkType.parse("relates")).toThrow();
  });
});

describe("NewNoteLinkSchema", () => {
  it("defaults link_type to 'references'", () => {
    const parsed = NewNoteLinkSchema.parse({
      from_note_id: "550e8400-e29b-41d4-a716-446655440000",
      to_note_id: "550e8400-e29b-41d4-a716-446655440001"
    });
    expect(parsed.link_type).toBe("references");
  });

  it("rejects same from/to", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(() =>
      NewNoteLinkSchema.parse({ from_note_id: id, to_note_id: id })
    ).toThrow();
  });
});
