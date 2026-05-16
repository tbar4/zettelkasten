import { describe, it, expect } from "vitest";
import { app } from "../src/server";

async function get(path: string): Promise<Response> {
  return app.request(path, { method: "GET" });
}

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

describe("GET /api/custom-link-types", () => {
  it("returns empty array when none exist", async () => {
    const res = await get("/api/custom-link-types");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { customLinkTypes: unknown[] };
    expect(body.customLinkTypes).toEqual([]);
  });

  it("returns existing types", async () => {
    await post("/api/custom-link-types", { name: "inspires" });
    const res = await get("/api/custom-link-types");
    const body = (await res.json()) as {
      customLinkTypes: { name: string }[];
    };
    expect(body.customLinkTypes).toHaveLength(1);
    expect(body.customLinkTypes[0]!.name).toBe("inspires");
  });
});

describe("POST /api/custom-link-types", () => {
  it("creates a custom link type", async () => {
    const res = await post("/api/custom-link-types", {
      name: "motivates",
      description: "A motivates B"
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      name: string;
      description: string;
    };
    expect(body.name).toBe("motivates");
    expect(body.description).toBe("A motivates B");
    expect(body.id).toBeTruthy();
  });

  it("returns 409 on duplicate name", async () => {
    await post("/api/custom-link-types", { name: "dup" });
    const res = await post("/api/custom-link-types", { name: "dup" });
    expect(res.status).toBe(409);
  });

  it("returns 400 when name is empty string", async () => {
    const res = await post("/api/custom-link-types", { name: "" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    const res = await post("/api/custom-link-types", {});
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/custom-link-types/:id", () => {
  it("renames a custom link type", async () => {
    const created = (await (
      await post("/api/custom-link-types", { name: "old-name" })
    ).json()) as { id: string };

    const res = await patch(`/api/custom-link-types/${created.id}`, {
      name: "new-name"
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("new-name");
  });

  it("returns 404 for unknown id", async () => {
    const res = await patch(
      "/api/custom-link-types/550e8400-e29b-41d4-a716-446655440099",
      { name: "x" }
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 on name collision", async () => {
    await post("/api/custom-link-types", { name: "alpha" });
    const beta = (await (
      await post("/api/custom-link-types", { name: "beta" })
    ).json()) as { id: string };

    const res = await patch(`/api/custom-link-types/${beta.id}`, {
      name: "alpha"
    });
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/custom-link-types/:id", () => {
  it("deletes a custom link type", async () => {
    const created = (await (
      await post("/api/custom-link-types", { name: "to-delete" })
    ).json()) as { id: string };

    const res = await del(`/api/custom-link-types/${created.id}`);
    expect(res.status).toBe(204);

    const list = (await (await get("/api/custom-link-types")).json()) as {
      customLinkTypes: unknown[];
    };
    expect(list.customLinkTypes).toHaveLength(0);
  });

  it("returns 404 for unknown id", async () => {
    const res = await del(
      "/api/custom-link-types/550e8400-e29b-41d4-a716-446655440099"
    );
    expect(res.status).toBe(404);
  });
});
