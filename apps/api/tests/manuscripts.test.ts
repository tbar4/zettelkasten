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

async function createNote(type: string, title: string, bodyMd?: string): Promise<{ id: string }> {
  const res = await post("/api/notes", { type, title, body_md: bodyMd });
  return (await res.json()) as { id: string };
}

async function createManuscript(title: string, anchorTopicIds?: string[]): Promise<{
  id: string;
  title: string;
  anchor_topic_ids: string[];
  sections: unknown[];
}> {
  const res = await post("/api/manuscripts", { title, anchorTopicIds });
  expect(res.status).toBe(201);
  return (await res.json()) as {
    id: string;
    title: string;
    anchor_topic_ids: string[];
    sections: unknown[];
  };
}

describe("GET /api/manuscripts", () => {
  it("returns empty list initially", async () => {
    const res = await get("/api/manuscripts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { manuscripts: unknown[] };
    expect(body.manuscripts).toEqual([]);
  });

  it("returns list with counts after creating manuscripts", async () => {
    const m = await createManuscript("Draft 1");
    const res = await get("/api/manuscripts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      manuscripts: { id: string; anchor_count: number; section_count: number }[];
    };
    expect(body.manuscripts).toHaveLength(1);
    expect(body.manuscripts[0]!.id).toBe(m.id);
    expect(body.manuscripts[0]!.anchor_count).toBe(0);
    expect(body.manuscripts[0]!.section_count).toBe(0);
  });
});

describe("POST /api/manuscripts", () => {
  it("creates a manuscript", async () => {
    const res = await post("/api/manuscripts", { title: "My Manuscript" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; title: string; sections: unknown[] };
    expect(body.id).toBeTruthy();
    expect(body.title).toBe("My Manuscript");
    expect(body.sections).toEqual([]);
  });

  it("creates with anchor topic ids", async () => {
    const topic = await createNote("topic", "A Topic");
    const res = await post("/api/manuscripts", {
      title: "Anchored",
      anchorTopicIds: [topic.id]
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { anchor_topic_ids: string[] };
    expect(body.anchor_topic_ids).toEqual([topic.id]);
  });

  it("rejects anchor topic id that is not a topic note", async () => {
    const note = await createNote("fleeting", "Not a topic");
    const res = await post("/api/manuscripts", {
      title: "Bad",
      anchorTopicIds: [note.id]
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-existent anchor topic id", async () => {
    const res = await post("/api/manuscripts", {
      title: "Bad",
      anchorTopicIds: [NON_EXISTENT_UUID]
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for missing title", async () => {
    const res = await post("/api/manuscripts", {});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/manuscripts/:id", () => {
  it("returns 404 for non-existent manuscript", async () => {
    const res = await get(`/api/manuscripts/${NON_EXISTENT_UUID}`);
    expect(res.status).toBe(404);
  });

  it("returns manuscript with empty sections", async () => {
    const m = await createManuscript("My Draft");
    const res = await get(`/api/manuscripts/${m.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; sections: unknown[] };
    expect(body.id).toBe(m.id);
    expect(body.sections).toEqual([]);
  });
});

describe("PATCH /api/manuscripts/:id", () => {
  it("updates title", async () => {
    const m = await createManuscript("Old");
    const res = await patch(`/api/manuscripts/${m.id}`, { title: "New" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("New");
  });

  it("updates anchor topic ids", async () => {
    const topic = await createNote("topic", "Topic A");
    const m = await createManuscript("Draft");
    const res = await patch(`/api/manuscripts/${m.id}`, {
      anchorTopicIds: [topic.id]
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { anchor_topic_ids: string[] };
    expect(body.anchor_topic_ids).toEqual([topic.id]);
  });

  it("returns 404 for non-existent manuscript", async () => {
    const res = await patch(`/api/manuscripts/${NON_EXISTENT_UUID}`, { title: "X" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/manuscripts/:id", () => {
  it("deletes a manuscript", async () => {
    const m = await createManuscript("To Delete");
    const res = await del(`/api/manuscripts/${m.id}`);
    expect(res.status).toBe(204);
    const getRes = await get(`/api/manuscripts/${m.id}`);
    expect(getRes.status).toBe(404);
  });

  it("returns 404 for non-existent manuscript", async () => {
    const res = await del(`/api/manuscripts/${NON_EXISTENT_UUID}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/manuscripts/:id/sections", () => {
  it("adds a transcluded section (default)", async () => {
    const note = await createNote("permanent", "My Note", "body content");
    const m = await createManuscript("Draft");
    const res = await post(`/api/manuscripts/${m.id}/sections`, {
      noteId: note.id
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      note_id: string;
      is_transclusion: boolean;
      frozen_body_md: null;
      body_md: string;
    };
    expect(body.note_id).toBe(note.id);
    expect(body.is_transclusion).toBe(true);
    expect(body.frozen_body_md).toBeNull();
    expect(body.body_md).toBe("body content");
  });

  it("copy section snapshots note body into frozen_body_md", async () => {
    const note = await createNote("permanent", "My Note", "snapshot this");
    const m = await createManuscript("Draft");
    const res = await post(`/api/manuscripts/${m.id}/sections`, {
      noteId: note.id,
      isTransclusion: false
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      is_transclusion: boolean;
      frozen_body_md: string;
      body_md: string;
    };
    expect(body.is_transclusion).toBe(false);
    expect(body.frozen_body_md).toBe("snapshot this");
    expect(body.body_md).toBe("snapshot this");
  });

  it("adds a free-form section with no note", async () => {
    const m = await createManuscript("Draft");
    const res = await post(`/api/manuscripts/${m.id}/sections`, {
      frozenBodyMd: "free text",
      isTransclusion: false
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { note_id: null; frozen_body_md: string };
    expect(body.note_id).toBeNull();
    expect(body.frozen_body_md).toBe("free text");
  });

  it("assigns sparse positions (multiples of 10)", async () => {
    const m = await createManuscript("Draft");
    const s1Res = await post(`/api/manuscripts/${m.id}/sections`, { heading: "A" });
    const s2Res = await post(`/api/manuscripts/${m.id}/sections`, { heading: "B" });
    const s3Res = await post(`/api/manuscripts/${m.id}/sections`, { heading: "C" });
    expect(s1Res.status).toBe(201);
    expect(s2Res.status).toBe(201);
    expect(s3Res.status).toBe(201);
    const s1 = (await s1Res.json()) as { position: number };
    const s2 = (await s2Res.json()) as { position: number };
    const s3 = (await s3Res.json()) as { position: number };
    expect(s1.position).toBe(10);
    expect(s2.position).toBe(20);
    expect(s3.position).toBe(30);
  });

  it("returns 404 for non-existent manuscript", async () => {
    const res = await post(`/api/manuscripts/${NON_EXISTENT_UUID}/sections`, {});
    expect(res.status).toBe(404);
  });

  it("returns sections in position order from GET", async () => {
    const m = await createManuscript("Draft");
    await post(`/api/manuscripts/${m.id}/sections`, { heading: "First", position: 10 });
    await post(`/api/manuscripts/${m.id}/sections`, { heading: "Second", position: 20 });
    const res = await get(`/api/manuscripts/${m.id}`);
    const body = (await res.json()) as { sections: { heading: string; position: number }[] };
    expect(body.sections[0]!.heading).toBe("First");
    expect(body.sections[1]!.heading).toBe("Second");
  });
});

describe("PATCH /api/manuscripts/sections/:sectionId", () => {
  it("updates heading", async () => {
    const m = await createManuscript("Draft");
    const secRes = await post(`/api/manuscripts/${m.id}/sections`, { heading: "Old" });
    const sec = (await secRes.json()) as { id: string };
    const res = await patch(`/api/manuscripts/sections/${sec.id}`, { heading: "New" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { heading: string };
    expect(body.heading).toBe("New");
  });

  it("toggling to copy (isTransclusion=false) re-snapshots note body", async () => {
    const note = await createNote("permanent", "Note", "original");
    const m = await createManuscript("Draft");
    const secRes = await post(`/api/manuscripts/${m.id}/sections`, {
      noteId: note.id,
      isTransclusion: true
    });
    const sec = (await secRes.json()) as { id: string; frozen_body_md: null };
    expect(sec.frozen_body_md).toBeNull();

    const res = await patch(`/api/manuscripts/sections/${sec.id}`, {
      isTransclusion: false
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { is_transclusion: boolean; frozen_body_md: string };
    expect(body.is_transclusion).toBe(false);
    expect(body.frozen_body_md).toBe("original");
  });

  it("toggling back to transclusion (isTransclusion=true) clears frozen_body_md", async () => {
    const note = await createNote("permanent", "Note", "original");
    const m = await createManuscript("Draft");
    const secRes = await post(`/api/manuscripts/${m.id}/sections`, {
      noteId: note.id,
      isTransclusion: false
    });
    const sec = (await secRes.json()) as { id: string };

    const res = await patch(`/api/manuscripts/sections/${sec.id}`, {
      isTransclusion: true
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { is_transclusion: boolean; frozen_body_md: null };
    expect(body.is_transclusion).toBe(true);
    expect(body.frozen_body_md).toBeNull();
  });

  it("reorders sections", async () => {
    const m = await createManuscript("Draft");
    const s1Res = await post(`/api/manuscripts/${m.id}/sections`, { heading: "A" });
    const s2Res = await post(`/api/manuscripts/${m.id}/sections`, { heading: "B" });
    const s1 = (await s1Res.json()) as { id: string; position: number };
    const s2 = (await s2Res.json()) as { id: string; position: number };
    expect(s1.position).toBe(10);
    expect(s2.position).toBe(20);

    const res = await patch(`/api/manuscripts/sections/${s2.id}`, {
      position: 5
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { position: number };
    expect(updated.position).toBe(5);

    const getRes = await get(`/api/manuscripts/${m.id}`);
    const mBody = (await getRes.json()) as { sections: { heading: string }[] };
    expect(mBody.sections[0]!.heading).toBe("B");
    expect(mBody.sections[1]!.heading).toBe("A");
  });

  it("returns 404 for non-existent section", async () => {
    const res = await patch(`/api/manuscripts/sections/${NON_EXISTENT_UUID}`, { heading: "X" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/manuscripts/sections/:sectionId", () => {
  it("deletes a section", async () => {
    const m = await createManuscript("Draft");
    const secRes = await post(`/api/manuscripts/${m.id}/sections`, { heading: "A" });
    const sec = (await secRes.json()) as { id: string };

    const res = await del(`/api/manuscripts/sections/${sec.id}`);
    expect(res.status).toBe(204);

    const getRes = await get(`/api/manuscripts/${m.id}`);
    const body = (await getRes.json()) as { sections: unknown[] };
    expect(body.sections).toHaveLength(0);
  });

  it("returns 404 for non-existent section", async () => {
    const res = await del(`/api/manuscripts/sections/${NON_EXISTENT_UUID}`);
    expect(res.status).toBe(404);
  });
});
