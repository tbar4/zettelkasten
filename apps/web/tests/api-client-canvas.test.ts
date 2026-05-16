import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";

const CANVAS_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const TOPIC_NOTE_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const NOTE_ID = "aaaaaaaa-0000-0000-0000-000000000003";
const ITEM_ID = "aaaaaaaa-0000-0000-0000-000000000004";
const EDGE_ID = "aaaaaaaa-0000-0000-0000-000000000005";

const mockCanvas = {
  id: CANVAS_ID,
  topic_note_id: TOPIC_NOTE_ID,
  scene_data: null,
  viewport: null,
  theme: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  items: [],
  edges: []
};

const mockItem = {
  id: ITEM_ID,
  canvas_id: CANVAS_ID,
  note_id: NOTE_ID,
  x: 100,
  y: 200,
  width: 200,
  height: 120,
  color: null,
  z_index: 0,
  created_at: "2026-01-01T00:00:00Z"
};

const mockEdge = {
  id: EDGE_ID,
  canvas_id: CANVAS_ID,
  from_item_id: ITEM_ID,
  to_item_id: "aaaaaaaa-0000-0000-0000-000000000006",
  label: null,
  color: null,
  created_at: "2026-01-01T00:00:00Z"
};

describe("canvas api client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("canvasByTopic() calls GET /api/canvases/by-topic/:topicNoteId", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockCanvas), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.canvasByTopic(TOPIC_NOTE_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/canvases/by-topic/${TOPIC_NOTE_ID}`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result.id).toBe(CANVAS_ID);
    expect(result.items).toEqual([]);
  });

  it("updateCanvas() calls PATCH /api/canvases/:id", async () => {
    const updated = { ...mockCanvas, theme: "dark" };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.updateCanvas(CANVAS_ID, { theme: "dark" });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/canvases/${CANVAS_ID}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ theme: "dark" })
      })
    );
    expect(result.theme).toBe("dark");
  });

  it("addCanvasItem() calls POST /api/canvases/:id/items", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockItem), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.addCanvasItem(CANVAS_ID, {
      noteId: NOTE_ID,
      x: 100,
      y: 200
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/canvases/${CANVAS_ID}/items`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ noteId: NOTE_ID, x: 100, y: 200 })
      })
    );
    expect(result.id).toBe(ITEM_ID);
    expect(result.note_id).toBe(NOTE_ID);
  });

  it("updateCanvasItem() calls PATCH /api/canvases/items/:itemId", async () => {
    const updated = { ...mockItem, x: 300 };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.updateCanvasItem(ITEM_ID, { x: 300 });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/canvases/items/${ITEM_ID}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ x: 300 })
      })
    );
    expect(result.x).toBe(300);
  });

  it("deleteCanvasItem() calls DELETE /api/canvases/items/:itemId", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.deleteCanvasItem(ITEM_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/canvases/items/${ITEM_ID}`,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("addCanvasEdge() calls POST /api/canvases/:id/edges", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockEdge), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    const toItemId = "aaaaaaaa-0000-0000-0000-000000000006";
    const result = await api.addCanvasEdge(CANVAS_ID, {
      fromItemId: ITEM_ID,
      toItemId
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/canvases/${CANVAS_ID}/edges`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ fromItemId: ITEM_ID, toItemId })
      })
    );
    expect(result.id).toBe(EDGE_ID);
  });

  it("deleteCanvasEdge() calls DELETE /api/canvases/edges/:edgeId", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.deleteCanvasEdge(EDGE_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/canvases/edges/${EDGE_ID}`,
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
