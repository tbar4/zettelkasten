import { describe, it, expect } from "vitest";
import { extractMentionIds, rewriteMentions } from "../src/notion/mentions";

describe("extractMentionIds", () => {
  it("returns empty for a body with no mentions", () => {
    expect(extractMentionIds("just text")).toEqual([]);
  });

  it("extracts a single mention id", () => {
    expect(
      extractMentionIds("see [[notion:page:abc-1234|Other]] for more")
    ).toEqual(["abc-1234"]);
  });

  it("deduplicates repeated mentions", () => {
    expect(
      extractMentionIds(
        "[[notion:page:abc-1|X]] and [[notion:page:abc-1|X]]"
      )
    ).toEqual(["abc-1"]);
  });

  it("extracts multiple distinct mentions", () => {
    expect(
      extractMentionIds(
        "[[notion:page:a-1|A]] and [[notion:page:b-2|B]]"
      ).sort()
    ).toEqual(["a-1", "b-2"]);
  });
});

describe("rewriteMentions", () => {
  it("replaces a mention with [[Title]] when a title is provided", () => {
    const out = rewriteMentions(
      "see [[notion:page:abc-1|FallbackLabel]] here",
      new Map([["abc-1", "Resolved Title"]])
    );
    expect(out).toBe("see [[Resolved Title]] here");
  });

  it("falls back to the embedded label when no title is provided", () => {
    const out = rewriteMentions(
      "see [[notion:page:abc-1|FallbackLabel]] here",
      new Map()
    );
    expect(out).toBe("see [[FallbackLabel]] here");
  });

  it("handles multiple mentions in one body", () => {
    const out = rewriteMentions(
      "[[notion:page:a|A]] and [[notion:page:b|B]]",
      new Map([
        ["a", "Resolved A"],
        ["b", "Resolved B"]
      ])
    );
    expect(out).toBe("[[Resolved A]] and [[Resolved B]]");
  });
});
