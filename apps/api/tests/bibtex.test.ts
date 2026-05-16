import { describe, it, expect } from "vitest";
import { sourcesToBibtex } from "../src/sources/bibtex";

function makeSource(overrides: Partial<{
  id: string;
  title: string;
  author: string | null;
  sourceType: string | null;
  url: string | null;
  isbn: string | null;
  readwiseBookId: string | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Default Title",
    author: null,
    sourceType: null,
    url: null,
    isbn: null,
    readwiseBookId: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides
  };
}

describe("sourcesToBibtex", () => {
  it("returns empty string for empty input", () => {
    expect(sourcesToBibtex([])).toBe("");
  });

  describe("entry types", () => {
    it("uses @book when isbn is present", () => {
      const s = makeSource({ isbn: "978-0-123" });
      expect(sourcesToBibtex([s])).toMatch(/^@book\{/);
    });

    it("uses @article when sourceType is 'article'", () => {
      const s = makeSource({ sourceType: "article" });
      expect(sourcesToBibtex([s])).toMatch(/^@article\{/);
    });

    it("uses @misc for anything else", () => {
      const s = makeSource({ sourceType: "blog" });
      expect(sourcesToBibtex([s])).toMatch(/^@misc\{/);
    });

    it("prefers @book over @article when both isbn and article type", () => {
      const s = makeSource({ isbn: "978-0-123", sourceType: "article" });
      expect(sourcesToBibtex([s])).toMatch(/^@book\{/);
    });
  });

  describe("cite key generation", () => {
    it("uses lastname-year format", () => {
      const s = makeSource({ author: "John Doe", title: "Something 2023 about things" });
      expect(sourcesToBibtex([s])).toMatch(/^@misc\{doe-2023,/);
    });

    it("extracts last word of multi-word author", () => {
      const s = makeSource({ author: "Mary Anne Smith", title: "Paper 2021" });
      expect(sourcesToBibtex([s])).toMatch(/^@misc\{smith-2021,/);
    });

    it("uses n.d. when no year found in title", () => {
      const s = makeSource({ author: "Jane Doe", title: "Timeless Essay" });
      expect(sourcesToBibtex([s])).toMatch(/^@misc\{doe-n\.d\.,/);
    });

    it("uses first 8 chars of id as prefix when no author", () => {
      const s = makeSource({ id: "abcdef12-0000-0000-0000-000000000000", title: "Anonymous Work" });
      expect(sourcesToBibtex([s])).toMatch(/^@misc\{abcdef12-n\.d\.,/);
    });

    it("strips non-alphanumeric from lastname", () => {
      const s = makeSource({ author: "O'Brien, Patrick", title: "Memoir 2020" });
      const result = sourcesToBibtex([s]);
      expect(result).toMatch(/^@misc\{patrick-2020,/);
    });

    it("extracts 19xx year from title", () => {
      const s = makeSource({ author: "Old Author", title: "A History Written in 1984" });
      expect(sourcesToBibtex([s])).toMatch(/^@misc\{author-1984,/);
    });
  });

  describe("fields", () => {
    it("always includes title with double braces", () => {
      const s = makeSource({ title: "My Book Title" });
      const result = sourcesToBibtex([s]);
      expect(result).toContain("title = {{My Book Title}}");
    });

    it("includes author field when present", () => {
      const s = makeSource({ author: "John Smith" });
      expect(sourcesToBibtex([s])).toContain("author = {John Smith}");
    });

    it("omits author field when null", () => {
      const s = makeSource({ author: null });
      expect(sourcesToBibtex([s])).not.toContain("author");
    });

    it("includes year field when extractable from title", () => {
      const s = makeSource({ title: "Modern Theory 2022" });
      expect(sourcesToBibtex([s])).toContain("year = {2022}");
    });

    it("omits year field when title has no year", () => {
      const s = makeSource({ title: "Timeless Work" });
      expect(sourcesToBibtex([s])).not.toContain("year");
    });

    it("includes url when present", () => {
      const s = makeSource({ url: "https://example.com/paper" });
      expect(sourcesToBibtex([s])).toContain("url = {https://example.com/paper}");
    });

    it("omits url when null", () => {
      const s = makeSource({ url: null });
      expect(sourcesToBibtex([s])).not.toContain("url");
    });

    it("includes isbn when present", () => {
      const s = makeSource({ isbn: "978-0-306-40615-7" });
      expect(sourcesToBibtex([s])).toContain("isbn = {978-0-306-40615-7}");
    });

    it("omits isbn when null", () => {
      const s = makeSource({ isbn: null });
      expect(sourcesToBibtex([s])).not.toContain("isbn");
    });

    it("always includes note = source id", () => {
      const s = makeSource({ id: "abcd1234-0000-0000-0000-000000000000" });
      expect(sourcesToBibtex([s])).toContain("note = {abcd1234-0000-0000-0000-000000000000}");
    });
  });

  describe("escaping", () => {
    it("escapes backslashes in title", () => {
      const s = makeSource({ title: "C:\\Program Files" });
      expect(sourcesToBibtex([s])).toContain("title = {{C:\\\\Program Files}}");
    });

    it("escapes percent signs", () => {
      const s = makeSource({ title: "50% Complete" });
      expect(sourcesToBibtex([s])).toContain("title = {{50\\% Complete}}");
    });

    it("escapes ampersands", () => {
      const s = makeSource({ title: "Smith & Wesson" });
      expect(sourcesToBibtex([s])).toContain("title = {{Smith \\& Wesson}}");
    });

    it("escapes hash signs", () => {
      const s = makeSource({ title: "Issue #42" });
      expect(sourcesToBibtex([s])).toContain("title = {{Issue \\#42}}");
    });

    it("escapes dollar signs", () => {
      const s = makeSource({ title: "Earn $100" });
      expect(sourcesToBibtex([s])).toContain("title = {{Earn \\$100}}");
    });

    it("escapes underscores", () => {
      const s = makeSource({ title: "snake_case title" });
      expect(sourcesToBibtex([s])).toContain("title = {{snake\\_case title}}");
    });

    it("escapes curly braces", () => {
      const s = makeSource({ title: "Set {Theory}" });
      expect(sourcesToBibtex([s])).toContain("title = {{Set \\{Theory\\}}}");
    });

    it("escapes in author field too", () => {
      const s = makeSource({ author: "Smith & Jones" });
      expect(sourcesToBibtex([s])).toContain("author = {Smith \\& Jones}");
    });
  });

  describe("multiple sources", () => {
    it("joins multiple entries with double newline", () => {
      const s1 = makeSource({ id: "00000000-0000-0000-0000-000000000001", title: "First Book 2020", author: "Alpha" });
      const s2 = makeSource({ id: "00000000-0000-0000-0000-000000000002", title: "Second Book 2021", author: "Beta" });
      const result = sourcesToBibtex([s1, s2]);
      expect(result).toContain("\n\n@");
      expect(result).toMatch(/@misc\{alpha-2020/);
      expect(result).toMatch(/@misc\{beta-2021/);
    });
  });
});
