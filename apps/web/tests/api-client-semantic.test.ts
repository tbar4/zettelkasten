import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";

describe("api client — semantic search", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  describe("searchSemantic()", () => {
    it("calls GET /api/search/semantic with q and default limit", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ results: [] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
      await api.searchSemantic("knowledge graphs");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/search/semantic?q=knowledge+graphs&limit=10",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("uses the provided limit", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ results: [] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
      await api.searchSemantic("foo", 5);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/search/semantic?q=foo&limit=5",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("returns results and reason from response", async () => {
      const payload = {
        results: [
          { id: "abc", title: "Note A", type: "fleeting", similarity: 0.9 }
        ]
      };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
      const result = await api.searchSemantic("test");
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.similarity).toBe(0.9);
    });

    it("returns reason when ML is unavailable", async () => {
      const payload = { results: [], reason: "ml-unavailable" };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
      const result = await api.searchSemantic("test");
      expect(result.results).toHaveLength(0);
      expect(result.reason).toBe("ml-unavailable");
    });
  });

  describe("getRelatedNotes()", () => {
    it("calls GET /api/notes/:id/related with default limit", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ results: [] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
      await api.getRelatedNotes("note-uuid-123");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notes/note-uuid-123/related?limit=8",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("uses the provided limit", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ results: [] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
      await api.getRelatedNotes("some-id", 5);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notes/some-id/related?limit=5",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("returns results with similarity scores", async () => {
      const payload = {
        results: [
          { id: "r1", title: "Related 1", type: "permanent", similarity: 0.85 },
          { id: "r2", title: "Related 2", type: "fleeting", similarity: 0.72 }
        ]
      };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
      const result = await api.getRelatedNotes("some-id");
      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.similarity).toBe(0.85);
    });

    it("returns reason when note has no embedding", async () => {
      const payload = { results: [], reason: "no-embedding" };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
      const result = await api.getRelatedNotes("some-id");
      expect(result.results).toHaveLength(0);
      expect(result.reason).toBe("no-embedding");
    });
  });
});
