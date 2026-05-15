import { describe, it, expect } from "vitest";
import { extractWikilinks, WIKILINK_REGEX } from "../src/wikilinks";

describe("extractWikilinks", () => {
  it("returns empty for text with no wikilinks", () => {
    expect(extractWikilinks("just text")).toEqual([]);
    expect(extractWikilinks("")).toEqual([]);
  });

  it("extracts a single wikilink", () => {
    expect(extractWikilinks("see [[Other Note]] here")).toEqual([
      { title: "Other Note", start: 4, end: 18 }
    ]);
  });

  it("extracts multiple wikilinks", () => {
    const text = "[[A]] then [[B]] then [[C]]";
    const result = extractWikilinks(text);
    expect(result.map((w) => w.title)).toEqual(["A", "B", "C"]);
  });

  it("deduplicates by title for the unique-title use case", () => {
    const text = "[[A]] and again [[A]]";
    const titles = Array.from(new Set(extractWikilinks(text).map((w) => w.title)));
    expect(titles).toEqual(["A"]);
  });

  it("ignores escaped brackets", () => {
    // For Plan 2 we don't support escaping; just confirm we don't crash on edge input.
    // "\\[[NotALink]]" is a 13-char string: \[[NotALink]] — backslash is 1 char,
    // so [[ starts at index 1 and the full match ends at index 13.
    expect(extractWikilinks("\\[[NotALink]]")).toEqual([
      { title: "NotALink", start: 1, end: 13 }
    ]);
  });

  it("ignores empty wikilinks", () => {
    expect(extractWikilinks("[[]]")).toEqual([]);
  });

  it("trims whitespace in titles", () => {
    expect(extractWikilinks("[[  Title  ]]")).toEqual([
      { title: "Title", start: 0, end: 13 }
    ]);
  });

  it("regex captures the title group", () => {
    // String.match with a /g regex returns full matches only (no capture groups).
    // Use exec (or a non-g copy) to access group 1.
    const re = new RegExp(WIKILINK_REGEX.source);
    const m = "before [[Foo Bar]] after".match(re);
    expect(m?.[1]).toBe("Foo Bar");
  });
});
