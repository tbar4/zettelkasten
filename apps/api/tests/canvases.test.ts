import { describe, it, expect } from "vitest";
import { app } from "../src/server";

const NON_EXISTENT_UUID = "550e8400-e29b-41d4-a716-446655440099";

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function patch(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function del(path: string): Promise<Response> {
  return app.request(path, { method: "DELETE" });
}

async function get(path: string): Promise<Response> {
  return app.request(path, { method: "GET" });
}

async function createNote(type: string, title: string): Promise<{ id: string }> {
  const res = await post("/api/notes", { type, title });
  return (await res.json()) as { id: string };
}

describe("GET /api/canvases/by-topic/:topicNoteId", () => {
  it("returns 404 for non-existent note", async () => {
    const res = await get(`/api/canvases/by-topic/${NON_EXISTENT_UUID}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-topic note", async () => {
    const note = await createNote("fleeting", "My fleeting");
    const res = await get(`/api/canvases/by-topic/${note.id}`);
    expect(res.status).toBe(404);
  });

  it("creates and returns a canvas for a topic note", async () => {
    const note = await createNote("topic", "My topic");
    const res = await get(`/api/canvases/by-topic/${note.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      topic_note_id: string;
      items: unknown[];
      edges: unknown[];
    };
    expect(body.id).toBeTruthy();
    expect(body.topic_note_id).toBe(note.id);
    expect(body.items).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  it("returns the same canvas on subsequent calls (get-or-create idempotent)", async () => {
    const note = await createNote("topic", "My topic 2");
    const res1 = await get(`/api/canvases/by-topic/${note.id}`);
    const body1 = (await res1.json()) as { id: string };
    const res2 = await get(`/api/canvases/by-topic/${note.id}`);
    const body2 = (await res2.json()) as { id: string };
    expect(body1.id).toBe(body2.id);
  });
});

describe("PATCH /api/canvases/:id", () => {
  it("updates scene_data, viewport, theme", async () => {
    const note = await createNote("topic", "Canvas topic");
    const canvas = (await (
      await get(`/api/canvases/by-topic/${note.id}`)
    ).json()) as { id: string };

    const res = await patch(`/api/canvases/${canvas.id}`, {
      scene_data: JSON.stringify({ elements: [] }),
      viewport: JSON.stringify({ zoom: 1, x: 0, y: 0 }),
      theme: "dark"
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scene_data: string;
      theme: string;
    };
    expect(JSON.parse(body.scene_data)).toEqual({ elements: [] });
    expect(body.theme).toBe("dark");
  });

  it("returns 404 for unknown canvas id", async () => {
    const res = await patch(`/api/canvases/${NON_EXISTENT_UUID}`, {
      theme: "dark"
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/canvases/:id/items", () => {
  it("adds an item to the canvas", async () => {
    const topic = await createNote("topic", "Topic for items");
    const noteRef = await createNote("fleeting", "Ref note");
    const canvas = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { id: string };

    const res = await post(`/api/canvases/${canvas.id}/items`, {
      noteId: noteRef.id,
      x: 100,
      y: 200
    });
    expect(res.status).toBe(201);
    const item = (await res.json()) as {
      id: string;
      note_id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
    expect(item.id).toBeTruthy();
    expect(item.note_id).toBe(noteRef.id);
    expect(item.x).toBe(100);
    expect(item.y).toBe(200);
    expect(item.width).toBe(200);
    expect(item.height).toBe(120);
  });

  it("returns items in the canvas response", async () => {
    const topic = await createNote("topic", "Topic for items check");
    const noteRef = await createNote("fleeting", "Ref note 2");
    const canvas = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { id: string };

    await post(`/api/canvases/${canvas.id}/items`, {
      noteId: noteRef.id,
      x: 10,
      y: 20
    });

    const refreshed = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { items: { note_id: string }[] };
    expect(refreshed.items).toHaveLength(1);
    expect(refreshed.items[0]!.note_id).toBe(noteRef.id);
  });

  it("returns 404 for unknown canvas", async () => {
    const noteRef = await createNote("fleeting", "orphan note");
    const res = await post(`/api/canvases/${NON_EXISTENT_UUID}/items`, {
      noteId: noteRef.id,
      x: 0,
      y: 0
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/canvases/items/:itemId", () => {
  it("updates item position", async () => {
    const topic = await createNote("topic", "Topic patch item");
    const noteRef = await createNote("fleeting", "Note for patch");
    const canvas = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { id: string };
    const item = (await (
      await post(`/api/canvases/${canvas.id}/items`, {
        noteId: noteRef.id,
        x: 0,
        y: 0
      })
    ).json()) as { id: string };

    const res = await patch(`/api/canvases/items/${item.id}`, {
      x: 300,
      y: 400,
      width: 250
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { x: number; y: number; width: number };
    expect(updated.x).toBe(300);
    expect(updated.y).toBe(400);
    expect(updated.width).toBe(250);
  });

  it("returns 404 for unknown item", async () => {
    const res = await patch(`/api/canvases/items/${NON_EXISTENT_UUID}`, {
      x: 1
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/canvases/items/:itemId", () => {
  it("deletes an item", async () => {
    const topic = await createNote("topic", "Topic del item");
    const noteRef = await createNote("fleeting", "Note del item");
    const canvas = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { id: string };
    const item = (await (
      await post(`/api/canvases/${canvas.id}/items`, {
        noteId: noteRef.id,
        x: 0,
        y: 0
      })
    ).json()) as { id: string };

    const res = await del(`/api/canvases/items/${item.id}`);
    expect(res.status).toBe(204);

    const refreshed = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { items: unknown[] };
    expect(refreshed.items).toHaveLength(0);
  });

  it("returns 404 for unknown item", async () => {
    const res = await del(`/api/canvases/items/${NON_EXISTENT_UUID}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/canvases/:id/edges", () => {
  it("adds an edge between two items", async () => {
    const topic = await createNote("topic", "Topic edge");
    const noteA = await createNote("fleeting", "Note A edge");
    const noteB = await createNote("fleeting", "Note B edge");
    const canvas = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { id: string };
    const itemA = (await (
      await post(`/api/canvases/${canvas.id}/items`, {
        noteId: noteA.id,
        x: 0,
        y: 0
      })
    ).json()) as { id: string };
    const itemB = (await (
      await post(`/api/canvases/${canvas.id}/items`, {
        noteId: noteB.id,
        x: 300,
        y: 0
      })
    ).json()) as { id: string };

    const res = await post(`/api/canvases/${canvas.id}/edges`, {
      fromItemId: itemA.id,
      toItemId: itemB.id,
      label: "leads to"
    });
    expect(res.status).toBe(201);
    const edge = (await res.json()) as {
      id: string;
      from_item_id: string;
      to_item_id: string;
      label: string | null;
    };
    expect(edge.id).toBeTruthy();
    expect(edge.from_item_id).toBe(itemA.id);
    expect(edge.to_item_id).toBe(itemB.id);
    expect(edge.label).toBe("leads to");
  });

  it("returns edges in canvas response", async () => {
    const topic = await createNote("topic", "Topic edge check");
    const noteA = await createNote("fleeting", "Edge Note A");
    const noteB = await createNote("fleeting", "Edge Note B");
    const canvas = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { id: string };
    const itemA = (await (
      await post(`/api/canvases/${canvas.id}/items`, {
        noteId: noteA.id,
        x: 0,
        y: 0
      })
    ).json()) as { id: string };
    const itemB = (await (
      await post(`/api/canvases/${canvas.id}/items`, {
        noteId: noteB.id,
        x: 300,
        y: 0
      })
    ).json()) as { id: string };
    await post(`/api/canvases/${canvas.id}/edges`, {
      fromItemId: itemA.id,
      toItemId: itemB.id
    });

    const refreshed = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { edges: { from_item_id: string }[] };
    expect(refreshed.edges).toHaveLength(1);
    expect(refreshed.edges[0]!.from_item_id).toBe(itemA.id);
  });
});

describe("DELETE /api/canvases/edges/:edgeId", () => {
  it("deletes an edge", async () => {
    const topic = await createNote("topic", "Topic del edge");
    const noteA = await createNote("fleeting", "Del edge A");
    const noteB = await createNote("fleeting", "Del edge B");
    const canvas = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { id: string };
    const itemA = (await (
      await post(`/api/canvases/${canvas.id}/items`, {
        noteId: noteA.id,
        x: 0,
        y: 0
      })
    ).json()) as { id: string };
    const itemB = (await (
      await post(`/api/canvases/${canvas.id}/items`, {
        noteId: noteB.id,
        x: 300,
        y: 0
      })
    ).json()) as { id: string };
    const edge = (await (
      await post(`/api/canvases/${canvas.id}/edges`, {
        fromItemId: itemA.id,
        toItemId: itemB.id
      })
    ).json()) as { id: string };

    const res = await del(`/api/canvases/edges/${edge.id}`);
    expect(res.status).toBe(204);

    const refreshed = (await (
      await get(`/api/canvases/by-topic/${topic.id}`)
    ).json()) as { edges: unknown[] };
    expect(refreshed.edges).toHaveLength(0);
  });

  it("returns 404 for unknown edge", async () => {
    const res = await del(`/api/canvases/edges/${NON_EXISTENT_UUID}`);
    expect(res.status).toBe(404);
  });
});
