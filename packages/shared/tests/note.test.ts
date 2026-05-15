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

  it("allows body_md: null on a topic note", () => {
    const parsed = NewNoteSchema.parse({
      title: "Topic",
      type: "topic",
      body_md: null
    });
    expect(parsed.body_md).toBeNull();
  });

  it("rejects a non-null body_md on a topic note", () => {
    expect(() =>
      NewNoteSchema.parse({
        title: "Topic",
        type: "topic",
        body_md: "still forbidden"
      })
    ).toThrow();
  });

  it("allows body_md: null on a permanent note (explicit clear)", () => {
    const parsed = NewNoteSchema.parse({
      title: "Perm",
      type: "permanent",
      body_md: null
    });
    expect(parsed.body_md).toBeNull();
  });
});

describe("NoteSchema", () => {
  it("parses a full note record", () => {
    const note = NoteSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "permanent",
      title: "Idea",
      body_md: "Body",
      tags: ["focus"],
      sources: [],
      created_at: "2026-05-15T10:00:00.000Z",
      updated_at: "2026-05-15T10:00:00.000Z",
      archived_at: null,
      notion_page_id: null
    });
    expect(note.type).toBe("permanent");
    expect(note.tags).toEqual(["focus"]);
  });
});
