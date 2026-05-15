import { describe, it, expect } from "vitest";
import { app } from "../src/server";

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function createNote(): Promise<string> {
  const note = (await (
    await post("/api/notes", { title: "T", type: "permanent" })
  ).json()) as { id: string };
  return note.id;
}

describe("PUT /api/notes/:id/tags", () => {
  it("attaches a tag, creating it if missing", async () => {
    const id = await createNote();
    const res = await app.request(`/api/notes/${id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["dissertation", "method"] })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: string[] };
    expect(body.tags.sort()).toEqual(["dissertation", "method"]);
  });

  it("replaces the tag set on subsequent PUTs", async () => {
    const id = await createNote();
    await app.request(`/api/notes/${id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["a", "b"] })
    });
    const res = await app.request(`/api/notes/${id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["b", "c"] })
    });
    const body = (await res.json()) as { tags: string[] };
    expect(body.tags.sort()).toEqual(["b", "c"]);
  });

  it("rejects invalid tag names (uppercase)", async () => {
    const id = await createNote();
    const res = await app.request(`/api/notes/${id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["BadTag"] })
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tags", () => {
  it("returns all distinct tags with note counts", async () => {
    const a = await createNote();
    const b = await createNote();
    await app.request(`/api/notes/${a}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["x", "y"] })
    });
    await app.request(`/api/notes/${b}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["x"] })
    });

    const res = await app.request("/api/tags");
    const body = (await res.json()) as {
      tags: { name: string; count: number }[];
    };
    const byName = Object.fromEntries(body.tags.map((t) => [t.name, t.count]));
    expect(byName.x).toBe(2);
    expect(byName.y).toBe(1);
  });
});
