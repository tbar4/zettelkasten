import { describe, it, expect } from "vitest";
import { slugify, fileNameFor } from "../src/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips punctuation and accents", () => {
    expect(slugify("Café—Résumé!")).toBe("cafe-resume");
  });

  it("returns 'untitled' for empty/whitespace input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("   ")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("foo --- bar")).toBe("foo-bar");
  });

  it("truncates to 80 chars", () => {
    expect(slugify("a".repeat(120)).length).toBe(80);
  });
});

describe("fileNameFor", () => {
  it("combines slug and short id suffix", () => {
    expect(
      fileNameFor("Hello World", "550e8400-e29b-41d4-a716-446655440000")
    ).toBe("hello-world-550e8400.md");
  });
});
