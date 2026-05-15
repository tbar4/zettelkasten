import { describe, it, expect } from "vitest";
import { app } from "../src/server";

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("GET /api/graph", () => {
  it("returns nodes for non-archived notes and edges for note_links", async () => {
    const a = (await (
      await post("/api/notes", { title: "A", type: "permanent" })
    ).json()) as { id: string };
    const b = (await (
      await post("/api/notes", { title: "B", type: "permanent" })
    ).json()) as { id: string };
    await post("/api/links", {
      from_note_id: a.id,
      to_note_id: b.id,
      link_type: "supports"
    });

    const res = await app.request("/api/graph");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: { id: string; title: string; type: string }[];
      edges: {
        id: string;
        source: string;
        target: string;
        link_type: string;
      }[];
    };
    expect(body.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0]!.source).toBe(a.id);
    expect(body.edges[0]!.target).toBe(b.id);
    expect(body.edges[0]!.link_type).toBe("supports");
  });

  it("excludes archived notes from nodes and dangling edges", async () => {
    const a = (await (
      await post("/api/notes", { title: "A", type: "permanent" })
    ).json()) as { id: string };
    const b = (await (
      await post("/api/notes", { title: "B", type: "permanent" })
    ).json()) as { id: string };
    await post("/api/links", { from_note_id: a.id, to_note_id: b.id });
    await app.request(`/api/notes/${b.id}`, { method: "DELETE" });

    const res = await app.request("/api/graph");
    const body = (await res.json()) as {
      nodes: { id: string }[];
      edges: unknown[];
    };
    expect(body.nodes.map((n) => n.id)).toEqual([a.id]);
    expect(body.edges).toEqual([]);
  });
});
