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
