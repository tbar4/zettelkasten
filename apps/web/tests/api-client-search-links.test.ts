import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";

describe("api client — search and links", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("searchNotes() calls GET /api/notes/search with q", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ notes: [] }), { status: 200 })
    );
    await api.searchNotes("foo bar");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notes/search?q=foo+bar",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("getNoteLinks() calls GET /api/notes/:id/links", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ outgoing: [], incoming: [] }),
        { status: 200 }
      )
    );
    const result = await api.getNoteLinks("abc-id");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notes/abc-id/links",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual({ outgoing: [], incoming: [] });
  });
});
