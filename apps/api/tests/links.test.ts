import { describe, it, expect } from "vitest";
import { app } from "../src/server";

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function createNote(title: string, type = "permanent"): Promise<string> {
  const res = await post("/api/notes", { title, type });
  const note = (await res.json()) as { id: string };
  return note.id;
}

describe("POST /api/links", () => {
  it("creates a link with default 'references' type", async () => {
    const from = await createNote("A");
    const to = await createNote("B");
    const res = await post("/api/links", {
      from_note_id: from,
      to_note_id: to
    });
    expect(res.status).toBe(201);
    const link = (await res.json()) as { link_type: string };
    expect(link.link_type).toBe("references");
  });

  it("creates a link with a specific type and context", async () => {
    const from = await createNote("A");
    const to = await createNote("B");
    const res = await post("/api/links", {
      from_note_id: from,
      to_note_id: to,
      link_type: "supports",
      context: "B supports the claim in A"
    });
    expect(res.status).toBe(201);
    const link = (await res.json()) as {
      link_type: string;
      context: string;
    };
    expect(link.link_type).toBe("supports");
    expect(link.context).toBe("B supports the claim in A");
  });

  it("rejects self-link", async () => {
    const id = await createNote("Self");
    const res = await post("/api/links", {
      from_note_id: id,
      to_note_id: id
    });
    expect(res.status).toBe(400);
  });

  it("rejects link to non-existent note (404)", async () => {
    const from = await createNote("A");
    const res = await post("/api/links", {
      from_note_id: from,
      to_note_id: "550e8400-e29b-41d4-a716-446655440099"
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 on duplicate (same from, to, type)", async () => {
    const from = await createNote("A");
    const to = await createNote("B");
    await post("/api/links", { from_note_id: from, to_note_id: to });
    const dup = await post("/api/links", {
      from_note_id: from,
      to_note_id: to
    });
    expect(dup.status).toBe(409);
  });

  it("allows two links between the same notes with different types", async () => {
    const from = await createNote("A");
    const to = await createNote("B");
    const first = await post("/api/links", {
      from_note_id: from,
      to_note_id: to,
      link_type: "references"
    });
    expect(first.status).toBe(201);
    const second = await post("/api/links", {
      from_note_id: from,
      to_note_id: to,
      link_type: "supports"
    });
    expect(second.status).toBe(201);
  });
});

describe("GET /api/notes/:id/links", () => {
  it("returns outgoing and incoming separately", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    const c = await createNote("C");

    await post("/api/links", { from_note_id: a, to_note_id: b });
    await post("/api/links", { from_note_id: c, to_note_id: a });

    const res = await app.request(`/api/notes/${a}/links`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      outgoing: { to_note_id: string }[];
      incoming: { from_note_id: string }[];
    };
    expect(body.outgoing).toHaveLength(1);
    expect(body.outgoing[0]!.to_note_id).toBe(b);
    expect(body.incoming).toHaveLength(1);
    expect(body.incoming[0]!.from_note_id).toBe(c);
  });
});

describe("DELETE /api/links/:id", () => {
  it("deletes the link", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    const created = (await (
      await post("/api/links", { from_note_id: a, to_note_id: b })
    ).json()) as { id: string };

    const res = await app.request(`/api/links/${created.id}`, {
      method: "DELETE"
    });
    expect(res.status).toBe(204);

    const after = await (await app.request(`/api/notes/${a}/links`)).json();
    expect((after as { outgoing: unknown[] }).outgoing).toHaveLength(0);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request(
      "/api/links/550e8400-e29b-41d4-a716-446655440099",
      { method: "DELETE" }
    );
    expect(res.status).toBe(404);
  });
});
