import { describe, it, expect } from "vitest";
import { app } from "../src/server";

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/notes", () => {
  it("creates a permanent note", async () => {
    const res = await post("/api/notes", {
      title: "First note",
      type: "permanent",
      body_md: "Body"
    });
    expect(res.status).toBe(201);
    const note = (await res.json()) as {
      id: string;
      title: string;
      type: string;
      body_md: string | null;
    };
    expect(note.title).toBe("First note");
    expect(note.type).toBe("permanent");
    expect(note.body_md).toBe("Body");
    expect(note.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("creates a topic note with no body", async () => {
    const res = await post("/api/notes", {
      title: "My topic",
      type: "topic"
    });
    expect(res.status).toBe(201);
    const note = (await res.json()) as { body_md: string | null };
    expect(note.body_md).toBeNull();
  });

  it("rejects body_md on topic notes (400)", async () => {
    const res = await post("/api/notes", {
      title: "Bad topic",
      type: "topic",
      body_md: "forbidden"
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing title (400)", async () => {
    const res = await post("/api/notes", { type: "permanent" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/notes", () => {
  it("returns an empty array initially", async () => {
    const res = await app.request("/api/notes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toEqual([]);
  });

  it("returns created notes, newest first", async () => {
    await post("/api/notes", { title: "First", type: "permanent" });
    await new Promise((r) => setTimeout(r, 10));
    await post("/api/notes", { title: "Second", type: "permanent" });

    const res = await app.request("/api/notes");
    const body = (await res.json()) as {
      notes: { title: string }[];
    };
    expect(body.notes).toHaveLength(2);
    expect(body.notes[0]!.title).toBe("Second");
    expect(body.notes[1]!.title).toBe("First");
  });

  it("filters by type", async () => {
    await post("/api/notes", { title: "P", type: "permanent" });
    await post("/api/notes", { title: "T", type: "topic" });

    const res = await app.request("/api/notes?type=topic");
    const body = (await res.json()) as { notes: { type: string }[] };
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0]!.type).toBe("topic");
  });

  it("excludes archived notes by default", async () => {
    // Will be exercised more in Task 9; here just confirm endpoint shape.
    const res = await app.request("/api/notes");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/notes/:id", () => {
  it("returns the note", async () => {
    const created = (await (
      await post("/api/notes", { title: "Read me", type: "permanent" })
    ).json()) as { id: string };

    const res = await app.request(`/api/notes/${created.id}`);
    expect(res.status).toBe(200);
    const note = (await res.json()) as { title: string };
    expect(note.title).toBe("Read me");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request(
      "/api/notes/550e8400-e29b-41d4-a716-446655440099"
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-uuid id", async () => {
    const res = await app.request("/api/notes/not-a-uuid");
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/notes/:id", () => {
  async function patch(
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    return app.request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
  }

  it("updates title and body", async () => {
    const created = (await (
      await post("/api/notes", {
        title: "Original",
        type: "permanent",
        body_md: "before"
      })
    ).json()) as { id: string; updated_at: string };

    const res = await patch(
      `/api/notes/${created.id}`,
      { title: "Updated", body_md: "after" },
      { "if-match": created.updated_at }
    );
    expect(res.status).toBe(200);
    const note = (await res.json()) as { title: string; body_md: string };
    expect(note.title).toBe("Updated");
    expect(note.body_md).toBe("after");
  });

  it("returns 409 when If-Match doesn't match", async () => {
    const created = (await (
      await post("/api/notes", { title: "Orig", type: "permanent" })
    ).json()) as { id: string };

    const res = await patch(
      `/api/notes/${created.id}`,
      { title: "Updated" },
      { "if-match": "2000-01-01T00:00:00.000Z" }
    );
    expect(res.status).toBe(409);
  });

  it("requires If-Match header (400 if missing)", async () => {
    const created = (await (
      await post("/api/notes", { title: "Orig", type: "permanent" })
    ).json()) as { id: string };

    const res = await patch(`/api/notes/${created.id}`, { title: "X" });
    expect(res.status).toBe(400);
  });

  it("forbids body_md on topic notes", async () => {
    const created = (await (
      await post("/api/notes", { title: "Topic", type: "topic" })
    ).json()) as { id: string; updated_at: string };

    const res = await patch(
      `/api/notes/${created.id}`,
      { body_md: "should fail" },
      { "if-match": created.updated_at }
    );
    expect(res.status).toBe(400);
  });

  it("rejects type permanent → topic with existing body (no body clear)", async () => {
    const created = (await (
      await post("/api/notes", {
        title: "P",
        type: "permanent",
        body_md: "stays around"
      })
    ).json()) as { id: string; updated_at: string };

    const res = await patch(
      `/api/notes/${created.id}`,
      { type: "topic" },
      { "if-match": created.updated_at }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/body_md: null/);
  });

  it("allows type permanent → topic when body is cleared to null in same request", async () => {
    const created = (await (
      await post("/api/notes", {
        title: "P",
        type: "permanent",
        body_md: "will go away"
      })
    ).json()) as { id: string; updated_at: string };

    const res = await patch(
      `/api/notes/${created.id}`,
      { type: "topic", body_md: null },
      { "if-match": created.updated_at }
    );
    expect(res.status).toBe(200);
    const note = (await res.json()) as { type: string; body_md: string | null };
    expect(note.type).toBe("topic");
    expect(note.body_md).toBeNull();
  });
});

describe("DELETE /api/notes/:id", () => {
  it("archives the note", async () => {
    const created = (await (
      await post("/api/notes", { title: "Bye", type: "fleeting" })
    ).json()) as { id: string };

    const res = await app.request(`/api/notes/${created.id}`, {
      method: "DELETE"
    });
    expect(res.status).toBe(204);

    const list = await (await app.request("/api/notes")).json();
    expect((list as { notes: unknown[] }).notes).toHaveLength(0);

    const withArchived = await (
      await app.request("/api/notes?include_archived=true")
    ).json();
    expect((withArchived as { notes: unknown[] }).notes).toHaveLength(1);
  });
});
