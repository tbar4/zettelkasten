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

  it("filters by ids when ?ids= is provided", async () => {
    const a = (await (
      await post("/api/notes", { title: "A", type: "permanent" })
    ).json()) as { id: string };
    const b = (await (
      await post("/api/notes", { title: "B", type: "permanent" })
    ).json()) as { id: string };
    await post("/api/notes", { title: "C", type: "permanent" });

    const res = await app.request(`/api/notes?ids=${a.id},${b.id}`);
    const body = (await res.json()) as { notes: { id: string }[] };
    const ids = body.notes.map((n) => n.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("returns empty array when ?ids= is empty", async () => {
    await post("/api/notes", { title: "X", type: "fleeting" });
    const res = await app.request("/api/notes?ids=");
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toEqual([]);
  });

  it("respects ?fields= for slim responses", async () => {
    const a = (await (
      await post("/api/notes", { title: "Slim", type: "permanent" })
    ).json()) as { id: string };

    const res = await app.request(
      `/api/notes?ids=${a.id}&fields=id,title,type`
    );
    const body = (await res.json()) as { notes: Record<string, unknown>[] };
    expect(body.notes).toHaveLength(1);
    expect(Object.keys(body.notes[0]!).sort()).toEqual(["id", "title", "type"]);
  });

  it("includes tags on each note in list", async () => {
    const created = (await (
      await post("/api/notes", { title: "A", type: "permanent" })
    ).json()) as { id: string };
    await app.request(`/api/notes/${created.id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["x"] })
    });

    const res = await app.request("/api/notes");
    const body = (await res.json()) as { notes: { tags: string[] }[] };
    expect(body.notes[0]!.tags).toEqual(["x"]);
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

  it("includes tags in the response", async () => {
    const created = (await (
      await post("/api/notes", { title: "Tagged", type: "permanent" })
    ).json()) as { id: string };

    await app.request(`/api/notes/${created.id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["alpha", "beta"] })
    });

    const res = await app.request(`/api/notes/${created.id}`);
    const note = (await res.json()) as { tags: string[] };
    expect(note.tags.sort()).toEqual(["alpha", "beta"]);
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

describe("GET /api/notes/search", () => {
  it("returns matching notes by title (case-insensitive)", async () => {
    await post("/api/notes", { title: "Foucault: Discipline", type: "literature" });
    await post("/api/notes", { title: "Foucault: Power", type: "literature" });
    await post("/api/notes", { title: "Other thing", type: "permanent" });

    const res = await app.request("/api/notes/search?q=foucault");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notes: { id: string; title: string; type: string }[];
    };
    expect(body.notes).toHaveLength(2);
    expect(body.notes.every((n) => n.title.includes("Foucault"))).toBe(true);
  });

  it("returns empty array when nothing matches", async () => {
    await post("/api/notes", { title: "Hello", type: "permanent" });
    const res = await app.request("/api/notes/search?q=zzzzz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toEqual([]);
  });

  it("returns recent notes when q is empty", async () => {
    await post("/api/notes", { title: "Old", type: "fleeting" });
    await new Promise((r) => setTimeout(r, 5));
    await post("/api/notes", { title: "New", type: "fleeting" });
    const res = await app.request("/api/notes/search?q=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: { title: string }[] };
    expect(body.notes.map((n) => n.title)).toEqual(["New", "Old"]);
  });

  it("excludes archived notes", async () => {
    const created = (await (
      await post("/api/notes", { title: "Visible", type: "permanent" })
    ).json()) as { id: string };
    await app.request(`/api/notes/${created.id}`, { method: "DELETE" });

    const res = await app.request("/api/notes/search?q=visible");
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toEqual([]);
  });

  it("limits results to 10", async () => {
    for (let i = 0; i < 15; i++) {
      await post("/api/notes", { title: `Note ${i}`, type: "fleeting" });
    }
    const res = await app.request("/api/notes/search?q=note");
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toHaveLength(10);
  });

  it("ranks title matches above body matches", async () => {
    await post("/api/notes", {
      title: "Foucault",
      type: "literature",
      body_md: "x"
    });
    await post("/api/notes", {
      title: "Other",
      type: "permanent",
      body_md: "Foucault appears in body only"
    });
    const res = await app.request("/api/notes/search?q=Foucault");
    const body = (await res.json()) as {
      notes: { title: string }[];
    };
    expect(body.notes[0]!.title).toBe("Foucault");
    expect(body.notes[1]!.title).toBe("Other");
  });

  it("handles percent and underscore as literals (no LIKE-pattern injection)", async () => {
    await post("/api/notes", { title: "100%", type: "fleeting" });
    await post("/api/notes", { title: "snake_case", type: "fleeting" });
    await post("/api/notes", { title: "unrelated", type: "fleeting" });

    const pct = await app.request("/api/notes/search?q=100%25");
    // %25 is "%" url-encoded; the search should treat the % as text, not a wildcard.
    const pctBody = (await pct.json()) as { notes: { title: string }[] };
    expect(pctBody.notes.map((n) => n.title)).toContain("100%");
    expect(pctBody.notes.find((n) => n.title === "unrelated")).toBeUndefined();
  });

  it("is case-insensitive", async () => {
    await post("/api/notes", { title: "MixedCase", type: "fleeting" });
    const res = await app.request("/api/notes/search?q=mixedcase");
    const body = (await res.json()) as { notes: { title: string }[] };
    expect(body.notes.map((n) => n.title)).toContain("MixedCase");
  });
});

describe("wikilink sync on note write", () => {
  it("POST with a wikilink creates the corresponding note_link", async () => {
    const target = (await (
      await post("/api/notes", { title: "Target", type: "permanent" })
    ).json()) as { id: string };

    const created = (await (
      await post("/api/notes", {
        title: "Source",
        type: "permanent",
        body_md: "see [[Target]]"
      })
    ).json()) as { id: string };

    const links = await (
      await app.request(`/api/notes/${created.id}/links`)
    ).json();
    expect((links as { outgoing: { to_note_id: string }[] }).outgoing).toHaveLength(1);
    expect((links as { outgoing: { to_note_id: string }[] }).outgoing[0]!.to_note_id).toBe(
      target.id
    );
  });

  it("PATCH that removes a wikilink removes the note_link", async () => {
    await post("/api/notes", { title: "T", type: "permanent" });
    const src = (await (
      await post("/api/notes", {
        title: "S",
        type: "permanent",
        body_md: "[[T]]"
      })
    ).json()) as { id: string; updated_at: string };

    await app.request(`/api/notes/${src.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": src.updated_at
      },
      body: JSON.stringify({ body_md: "no link now" })
    });

    const links = (await (
      await app.request(`/api/notes/${src.id}/links`)
    ).json()) as { outgoing: unknown[] };
    expect(links.outgoing).toEqual([]);
  });

  it("does not re-run wikilink sync when only title changes", async () => {
    await post("/api/notes", { title: "T", type: "permanent" });
    const src = (await (
      await post("/api/notes", {
        title: "S",
        type: "permanent",
        body_md: "[[T]]"
      })
    ).json()) as { id: string; updated_at: string };

    const before = (await (
      await app.request(`/api/notes/${src.id}/links`)
    ).json()) as { outgoing: { id: string }[] };
    const linkIdBefore = before.outgoing[0]!.id;

    // PATCH only the title.
    await app.request(`/api/notes/${src.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": src.updated_at
      },
      body: JSON.stringify({ title: "S renamed" })
    });

    const after = (await (
      await app.request(`/api/notes/${src.id}/links`)
    ).json()) as { outgoing: { id: string }[] };
    // Same link id ⇒ no delete+reinsert happened.
    expect(after.outgoing[0]!.id).toBe(linkIdBefore);
  });

  it("manual links survive a wikilink-less PATCH", async () => {
    const target = (await (
      await post("/api/notes", { title: "T", type: "permanent" })
    ).json()) as { id: string };
    const src = (await (
      await post("/api/notes", {
        title: "S",
        type: "permanent",
        body_md: "first"
      })
    ).json()) as { id: string; updated_at: string };

    await post("/api/links", {
      from_note_id: src.id,
      to_note_id: target.id,
      link_type: "supports"
    });

    await app.request(`/api/notes/${src.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": src.updated_at
      },
      body: JSON.stringify({ body_md: "updated body" })
    });

    const links = (await (
      await app.request(`/api/notes/${src.id}/links`)
    ).json()) as { outgoing: { link_type: string; source: string }[] };
    expect(links.outgoing).toHaveLength(1);
    expect(links.outgoing[0]!.link_type).toBe("supports");
    expect(links.outgoing[0]!.source).toBe("manual");
  });
});
