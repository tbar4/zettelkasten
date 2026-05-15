import { describe, it, expect } from "vitest";
import { app } from "../src/server";

describe("GET /health", () => {
  it("returns 200 and ok status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
