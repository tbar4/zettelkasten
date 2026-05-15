import { describe, it, expect } from "vitest";
import { NoteType, NoteSchema, NewNoteSchema } from "../src/note";

describe("NoteType", () => {
  it("accepts the four tier values", () => {
    for (const t of ["fleeting", "literature", "permanent", "topic"]) {
      expect(NoteType.parse(t)).toBe(t);
    }
  });

  it("rejects unknown values", () => {
    expect(() => NoteType.parse("project")).toThrow();
  });
});

describe("NewNoteSchema", () => {
  it("requires title and type", () => {
    expect(() =>
      NewNoteSchema.parse({ title: "", type: "permanent" })
    ).toThrow();
    expect(() =>
      NewNoteSchema.parse({ title: "Note", type: "invalid" as never })
    ).toThrow();
  });

  it("rejects body_md on topic notes", () => {
    expect(() =>
      NewNoteSchema.parse({
        title: "Topic",
        type: "topic",
        body_md: "should be forbidden"
      })
    ).toThrow();
  });

  it("accepts body_md on non-topic notes", () => {
    const parsed = NewNoteSchema.parse({
      title: "Permanent",
      type: "permanent",
      body_md: "some content"
    });
    expect(parsed.body_md).toBe("some content");
  });

  it("accepts a topic note with no body", () => {
    const parsed = NewNoteSchema.parse({ title: "Topic", type: "topic" });
    expect(parsed.body_md).toBeUndefined();
  });
});

describe("NoteSchema", () => {
  it("parses a full note record", () => {
    const note = NoteSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "permanent",
      title: "Idea",
      body_md: "Body",
      created_at: "2026-05-15T10:00:00.000Z",
      updated_at: "2026-05-15T10:00:00.000Z",
      archived_at: null,
      notion_page_id: null
    });
    expect(note.type).toBe("permanent");
  });
});
