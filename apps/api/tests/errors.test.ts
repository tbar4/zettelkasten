import { describe, it, expect } from "vitest";
import { app } from "../src/server";

describe("error shape consistency", () => {
  it("zod validation failure returns {error: string}", async () => {
    const res = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "", type: "permanent" })
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
    expect((body.error as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("success");
    expect(body).not.toHaveProperty("issues");
  });

  it("handcrafted 404 returns {error: string}", async () => {
    const res = await app.request(
      "/api/notes/550e8400-e29b-41d4-a716-446655440099"
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("zod failure on topic-with-body returns 400 with string error", async () => {
    const res = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "T", type: "topic", body_md: "no" })
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/topic notes must not have body_md/i);
  });
});
