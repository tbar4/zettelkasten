import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";

describe("api client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("listNotes() calls GET /api/notes and returns notes", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ notes: [{ id: "1", title: "x" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.listNotes();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notes",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.notes).toHaveLength(1);
  });

  it("createNote() POSTs and returns the created note", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "1", title: "x", type: "fleeting" }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );
    const result = await api.createNote({ title: "x", type: "fleeting" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "x", type: "fleeting" })
      })
    );
    expect(result.id).toBe("1");
  });

  it("throws on non-2xx with server message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad" }), { status: 400 })
    );
    await expect(api.createNote({ title: "", type: "fleeting" })).rejects.toThrow(
      "bad"
    );
  });
});
