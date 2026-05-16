import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";

// Tests for RelatedNotesPanel behavior via API client.
// The panel's API call is getRelatedNotes; the component hides when
// reason === "no-embedding" and shows cards when results are present.

describe("RelatedNotesPanel — api integration", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("calls /api/notes/:id/related with limit 8 by default", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    await api.getRelatedNotes("some-note-id");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notes/some-note-id/related?limit=8",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("returns no-embedding reason when note has no embedding (panel should hide)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [], reason: "no-embedding" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.getRelatedNotes("note-without-embedding");
    // Component hides when reason is "no-embedding"
    expect(result.reason).toBe("no-embedding");
    expect(result.results).toHaveLength(0);
  });

  it("returns related notes with id, title, type, and similarity", async () => {
    const payload = {
      results: [
        { id: "r1", title: "Relevant Note", type: "permanent", similarity: 0.88 },
        { id: "r2", title: "Also Relevant", type: "literature", similarity: 0.76 },
        { id: "r3", title: "Less Relevant", type: "fleeting", similarity: 0.61 }
      ]
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.getRelatedNotes("some-id");
    expect(result.results).toHaveLength(3);
    // Ordered by similarity descending (API's responsibility)
    expect(result.results[0]!.similarity).toBeGreaterThan(result.results[1]!.similarity);
    expect(result.results[1]!.similarity).toBeGreaterThan(result.results[2]!.similarity);
    // All required fields present
    expect(result.results[0]).toMatchObject({
      id: "r1",
      title: "Relevant Note",
      type: "permanent",
      similarity: 0.88
    });
  });

  it("similarity is a number between 0 and 1", async () => {
    const payload = {
      results: [
        { id: "x", title: "X", type: "fleeting", similarity: 0.75 }
      ]
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.getRelatedNotes("id");
    const sim = result.results[0]!.similarity;
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});
