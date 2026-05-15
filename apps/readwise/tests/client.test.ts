import { describe, it, expect, beforeEach, vi } from "vitest";
import { readwiseClient } from "../src/client";

describe("readwiseClient.exportHighlights", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("sends Authorization header and parses one page", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          count: 1,
          nextPageCursor: null,
          results: [
            {
              user_book_id: 12345,
              title: "Some Book",
              author: "Some Author",
              category: "books",
              source_url: null,
              asin: null,
              highlights: [
                {
                  id: 67890,
                  text: "highlight one",
                  note: "my note",
                  location: 42,
                  location_type: "order",
                  highlighted_at: "2026-05-15T10:00:00Z",
                  color: "yellow"
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const client = readwiseClient({
      token: "test-token",
      baseUrl: "https://readwise.io/api/v2"
    });
    const result = await client.exportHighlights();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, reqInit] = fetchMock.mock.calls[0]!;
    expect(reqUrl).toBe("https://readwise.io/api/v2/export/");
    expect(
      (reqInit as RequestInit).headers as Record<string, string>
    ).toMatchObject({ Authorization: "Token test-token" });

    expect(result.books).toHaveLength(1);
    expect(result.books[0]!.title).toBe("Some Book");
    expect(result.books[0]!.highlights[0]!.text).toBe("highlight one");
    expect(result.nextPageCursor).toBeNull();
  });

  it("paginates via pageCursor", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ count: 0, nextPageCursor: "abc", results: [] }),
        { status: 200 }
      )
    );
    const client = readwiseClient({
      token: "t",
      baseUrl: "https://readwise.io/api/v2"
    });
    await client.exportHighlights({ pageCursor: "xyz" });
    expect(fetchMock.mock.calls[0]![0]).toContain("pageCursor=xyz");
  });

  it("throws on non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );
    const client = readwiseClient({
      token: "bad",
      baseUrl: "https://readwise.io/api/v2"
    });
    await expect(client.exportHighlights()).rejects.toThrow(/401/);
  });
});
