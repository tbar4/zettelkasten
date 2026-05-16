import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";

// Tests for CommandPalette semantic toggle behavior via api-client integration.
// Full DOM rendering is skipped in this project's test style (api-client unit
// tests mirror the approach used in other test files).

describe("CommandPalette — semantic mode via api integration", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("text mode calls searchNotes (FTS path)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ notes: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    await api.searchNotes("knowledge");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/notes/search"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("semantic mode calls searchSemantic (vector path)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    await api.searchSemantic("knowledge graphs");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/search/semantic"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("semantic mode with ml-unavailable reason is surfaced to caller", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [], reason: "ml-unavailable" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.searchSemantic("something");
    expect(result.reason).toBe("ml-unavailable");
    expect(result.results).toHaveLength(0);
  });

  it("semantic mode with no-embedding reason is surfaced to caller", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [], reason: "no-embedding" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.searchSemantic("something");
    expect(result.reason).toBe("no-embedding");
  });

  it("semantic results include similarity scores", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            { id: "1", title: "Note One", type: "permanent", similarity: 0.95 },
            { id: "2", title: "Note Two", type: "fleeting", similarity: 0.72 }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const result = await api.searchSemantic("zettelkasten");
    expect(result.results[0]!.similarity).toBe(0.95);
    expect(result.results[1]!.similarity).toBe(0.72);
  });
});
