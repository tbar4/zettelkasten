import { describe, it, expect } from "vitest";
import { manuscriptToMarkdown, type ExportSection, type ExportSource, type ExportManuscript } from "../src/manuscripts/export-md";

function makeSection(overrides: Partial<ExportSection> = {}): ExportSection {
  return {
    id: "s1",
    position: 10,
    heading: null,
    noteId: null,
    noteTitle: null,
    isTransclusion: true,
    frozenBodyMd: null,
    noteBodyMd: null,
    ...overrides
  };
}

function makeSource(overrides: Partial<ExportSource> = {}): ExportSource {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "The Great Book",
    author: null,
    ...overrides
  };
}

const baseManuscript: ExportManuscript = { title: "My Paper", bodyMd: null };

describe("manuscriptToMarkdown", () => {
  it("renders title as h1", () => {
    const md = manuscriptToMarkdown(baseManuscript, [], new Map(), new Map());
    expect(md).toMatch(/^# My Paper/);
  });

  it("includes bodyMd below title when set", () => {
    const m: ExportManuscript = { title: "T", bodyMd: "Introduction text." };
    const md = manuscriptToMarkdown(m, [], new Map(), new Map());
    expect(md).toContain("Introduction text.");
  });

  it("renders section with explicit heading", () => {
    const section = makeSection({ heading: "Background", noteBodyMd: "Some content." });
    const md = manuscriptToMarkdown(baseManuscript, [section], new Map(), new Map());
    expect(md).toContain("## Background");
    expect(md).toContain("Some content.");
  });

  it("falls back to noteTitle when no heading", () => {
    const section = makeSection({ noteTitle: "Note about cats", noteBodyMd: "cats are great" });
    const md = manuscriptToMarkdown(baseManuscript, [section], new Map(), new Map());
    expect(md).toContain("## Note about cats");
  });

  it("falls back to 'Section N' when no heading or noteTitle", () => {
    const section = makeSection();
    const md = manuscriptToMarkdown(baseManuscript, [section], new Map(), new Map());
    expect(md).toContain("## Section 1");
  });

  it("transcluded section uses noteBodyMd", () => {
    const section = makeSection({
      isTransclusion: true,
      noteBodyMd: "live body",
      frozenBodyMd: "frozen body"
    });
    const md = manuscriptToMarkdown(baseManuscript, [section], new Map(), new Map());
    expect(md).toContain("live body");
    expect(md).not.toContain("frozen body");
  });

  it("copy section uses frozenBodyMd", () => {
    const section = makeSection({
      isTransclusion: false,
      noteBodyMd: "live body",
      frozenBodyMd: "frozen body"
    });
    const md = manuscriptToMarkdown(baseManuscript, [section], new Map(), new Map());
    expect(md).toContain("frozen body");
    expect(md).not.toContain("live body");
  });

  it("emits inline citation keys after section body", () => {
    const sourceId = "00000000-0000-0000-0000-000000000001";
    const noteId = "note-1";
    const source = makeSource({ id: sourceId, title: "Deep Work 2016", author: "Cal Newport" });
    const noteByIdMap = new Map([[noteId, { sources: [sourceId] }]]);
    const sourceByIdMap = new Map([[sourceId, source]]);

    const section = makeSection({ noteId, noteBodyMd: "focus matters" });
    const md = manuscriptToMarkdown(baseManuscript, [section], noteByIdMap, sourceByIdMap);

    expect(md).toContain("[@newport-2016]");
  });

  it("generates citation key from author lastname + year in title", () => {
    const sourceId = "src-1";
    const source = makeSource({
      id: sourceId,
      title: "Atomic Habits (2018)",
      author: "James Clear"
    });
    const noteId = "n1";
    const noteByIdMap = new Map([[noteId, { sources: [sourceId] }]]);
    const sourceByIdMap = new Map([[sourceId, source]]);

    const section = makeSection({ noteId, noteBodyMd: "habits" });
    const md = manuscriptToMarkdown(baseManuscript, [section], noteByIdMap, sourceByIdMap);

    // Last word of "James Clear" is "Clear" → "clear"
    expect(md).toContain("[@clear-2018]");
  });

  it("falls back to source.id slice when no author", () => {
    const sourceId = "abcdef12-1234-1234-1234-123456789012";
    const source = makeSource({ id: sourceId, title: "Unknown", author: null });
    const noteId = "n1";
    const noteByIdMap = new Map([[noteId, { sources: [sourceId] }]]);
    const sourceByIdMap = new Map([[sourceId, source]]);

    const section = makeSection({ noteId, noteBodyMd: "content" });
    const md = manuscriptToMarkdown(baseManuscript, [section], noteByIdMap, sourceByIdMap);

    expect(md).toContain("[@abcdef12]");
  });

  it("emits References section with all unique sources", () => {
    const sourceId = "src-1";
    const source = makeSource({
      id: sourceId,
      title: "Deep Work 2016",
      author: "Cal Newport"
    });
    const noteId = "n1";
    const noteByIdMap = new Map([[noteId, { sources: [sourceId] }]]);
    const sourceByIdMap = new Map([[sourceId, source]]);

    const section = makeSection({ noteId, noteBodyMd: "focus" });
    const md = manuscriptToMarkdown(baseManuscript, [section], noteByIdMap, sourceByIdMap);

    expect(md).toContain("## References");
    expect(md).toContain("[@newport-2016] Deep Work 2016 by Cal Newport");
  });

  it("deduplicates sources appearing in multiple sections", () => {
    const sourceId = "src-1";
    const source = makeSource({ id: sourceId, title: "Book", author: "Author" });
    const noteId1 = "n1";
    const noteId2 = "n2";
    const noteByIdMap = new Map([
      [noteId1, { sources: [sourceId] }],
      [noteId2, { sources: [sourceId] }]
    ]);
    const sourceByIdMap = new Map([[sourceId, source]]);

    const sections = [
      makeSection({ id: "s1", position: 10, noteId: noteId1, noteBodyMd: "body 1" }),
      makeSection({ id: "s2", position: 20, noteId: noteId2, noteBodyMd: "body 2" })
    ];
    const md = manuscriptToMarkdown(baseManuscript, sections, noteByIdMap, sourceByIdMap);

    // Inline citations appear once per section (before References)
    const [bodyPart, refPart] = md.split("## References");
    const inlineMatches = (bodyPart ?? "").match(/\[@author\]/g);
    expect(inlineMatches).toHaveLength(2); // once per section

    // References list has exactly one entry
    const refSectionMatches = (refPart ?? "").match(/\[@author\]/g);
    expect(refSectionMatches).toHaveLength(1);
  });

  it("does not emit References section when no sources", () => {
    const section = makeSection({ noteBodyMd: "content" });
    const md = manuscriptToMarkdown(baseManuscript, [section], new Map(), new Map());
    expect(md).not.toContain("## References");
  });

  it("renders multiple sections in order", () => {
    const sections = [
      makeSection({ id: "s1", position: 10, heading: "First", noteBodyMd: "A" }),
      makeSection({ id: "s2", position: 20, heading: "Second", noteBodyMd: "B" })
    ];
    const md = manuscriptToMarkdown(baseManuscript, sections, new Map(), new Map());
    const firstIdx = md.indexOf("## First");
    const secondIdx = md.indexOf("## Second");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(md).toContain("A");
    expect(md).toContain("B");
  });
});
