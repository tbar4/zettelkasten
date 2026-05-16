import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";

describe("api client — custom link types", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("listCustomLinkTypes() calls GET /api/custom-link-types", async () => {
    const types = [{ id: "1", name: "inspires", description: null, created_at: "2026-01-01T00:00:00.000Z" }];
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ customLinkTypes: types }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.listCustomLinkTypes();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/custom-link-types",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.customLinkTypes).toHaveLength(1);
    expect(result.customLinkTypes[0]!.name).toBe("inspires");
  });

  it("createCustomLinkType() POSTs and returns created type", async () => {
    const created = { id: "1", name: "motivates", description: null, created_at: "2026-01-01T00:00:00.000Z" };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.createCustomLinkType({ name: "motivates" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/custom-link-types",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "motivates" })
      })
    );
    expect(result.name).toBe("motivates");
  });

  it("updateCustomLinkType() PATCHes and returns updated type", async () => {
    const updated = { id: "1", name: "new-name", description: null, created_at: "2026-01-01T00:00:00.000Z" };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await api.updateCustomLinkType("1", { name: "new-name" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/custom-link-types/1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "new-name" })
      })
    );
    expect(result.name).toBe("new-name");
  });

  it("deleteCustomLinkType() sends DELETE", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.deleteCustomLinkType("1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/custom-link-types/1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
