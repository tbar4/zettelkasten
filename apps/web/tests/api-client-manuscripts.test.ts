import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";

describe("api client – manuscripts", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  const makeJson = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });

  const manuscriptSummary = {
    id: "m1",
    title: "Draft",
    anchor_topic_ids: [],
    anchor_count: 0,
    section_count: 0,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z"
  };

  const manuscriptDetail = {
    id: "m1",
    title: "Draft",
    anchor_topic_ids: [],
    body_md: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    sections: []
  };

  const section = {
    id: "s1",
    manuscript_id: "m1",
    position: 10,
    note_id: null,
    note_title: null,
    is_transclusion: true,
    frozen_body_md: null,
    body_md: null,
    heading: "Intro",
    created_at: "2024-01-01T00:00:00.000Z"
  };

  it("listManuscripts() GETs /api/manuscripts", async () => {
    fetchMock.mockResolvedValueOnce(makeJson({ manuscripts: [manuscriptSummary] }));
    const result = await api.listManuscripts();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manuscripts",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.manuscripts).toHaveLength(1);
  });

  it("createManuscript() POSTs to /api/manuscripts", async () => {
    fetchMock.mockResolvedValueOnce(makeJson(manuscriptDetail, 201));
    const result = await api.createManuscript({ title: "Draft" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manuscripts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Draft" })
      })
    );
    expect(result.id).toBe("m1");
  });

  it("createManuscript() sends anchorTopicIds when provided", async () => {
    fetchMock.mockResolvedValueOnce(makeJson(manuscriptDetail, 201));
    await api.createManuscript({ title: "Anchored", anchorTopicIds: ["t1"] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manuscripts",
      expect.objectContaining({
        body: JSON.stringify({ title: "Anchored", anchorTopicIds: ["t1"] })
      })
    );
  });

  it("getManuscript() GETs /api/manuscripts/:id", async () => {
    fetchMock.mockResolvedValueOnce(makeJson(manuscriptDetail));
    const result = await api.getManuscript("m1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manuscripts/m1",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.sections).toEqual([]);
  });

  it("updateManuscript() PATCHes /api/manuscripts/:id", async () => {
    fetchMock.mockResolvedValueOnce(makeJson({ ...manuscriptDetail, title: "Updated" }));
    const result = await api.updateManuscript("m1", { title: "Updated" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manuscripts/m1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Updated" })
      })
    );
    expect(result.title).toBe("Updated");
  });

  it("deleteManuscript() DELETEs /api/manuscripts/:id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.deleteManuscript("m1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manuscripts/m1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("addManuscriptSection() POSTs to /api/manuscripts/:id/sections", async () => {
    fetchMock.mockResolvedValueOnce(makeJson(section, 201));
    const result = await api.addManuscriptSection("m1", { heading: "Intro" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manuscripts/m1/sections",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ heading: "Intro" })
      })
    );
    expect(result.heading).toBe("Intro");
  });

  it("updateManuscriptSection() PATCHes /api/manuscripts/sections/:id", async () => {
    fetchMock.mockResolvedValueOnce(makeJson({ ...section, heading: "Updated" }));
    const result = await api.updateManuscriptSection("s1", { heading: "Updated" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manuscripts/sections/s1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ heading: "Updated" })
      })
    );
    expect(result.heading).toBe("Updated");
  });

  it("deleteManuscriptSection() DELETEs /api/manuscripts/sections/:id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.deleteManuscriptSection("s1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/manuscripts/sections/s1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("throws on non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(makeJson({ error: "not found" }, 404));
    await expect(api.getManuscript("bad-id")).rejects.toThrow("not found");
  });
});
