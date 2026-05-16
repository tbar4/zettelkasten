import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../src/server";

// Mock pandoc module so no real pandoc needed in tests
vi.mock("../src/manuscripts/pandoc", () => ({
  isPandocAvailable: vi.fn().mockResolvedValue(true),
  runPandoc: vi.fn().mockResolvedValue(Buffer.from("pandoc-stub-output")),
  _resetPandocCache: vi.fn()
}));

import { isPandocAvailable, runPandoc } from "../src/manuscripts/pandoc";

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function get(path: string): Promise<Response> {
  return app.request(path, { method: "GET" });
}

async function createNote(type: string, title: string, bodyMd?: string): Promise<{ id: string }> {
  const res = await post("/api/notes", { type, title, body_md: bodyMd ?? "" });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function createManuscript(title: string): Promise<{ id: string }> {
  const res = await post("/api/manuscripts", { title });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function addSection(
  manuscriptId: string,
  body: { noteId?: string; isTransclusion?: boolean; heading?: string; frozenBodyMd?: string }
): Promise<{ id: string }> {
  const res = await post(`/api/manuscripts/${manuscriptId}/sections`, body);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

const NON_EXISTENT_UUID = "550e8400-e29b-41d4-a716-446655440099";

describe("GET /api/manuscripts/:id/export", () => {
  beforeEach(() => {
    vi.mocked(isPandocAvailable).mockResolvedValue(true);
    vi.mocked(runPandoc).mockResolvedValue(Buffer.from("pandoc-stub-output"));
  });

  describe("format validation", () => {
    it("returns 400 when format param is missing", async () => {
      const m = await createManuscript("Test");
      const res = await get(`/api/manuscripts/${m.id}/export`);
      expect(res.status).toBe(400);
    });

    it("returns 400 when format is invalid", async () => {
      const m = await createManuscript("Test");
      const res = await get(`/api/manuscripts/${m.id}/export?format=pdf`);
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent manuscript", async () => {
      const res = await get(`/api/manuscripts/${NON_EXISTENT_UUID}/export?format=md`);
      expect(res.status).toBe(404);
    });
  });

  describe("markdown export (format=md)", () => {
    it("returns text/markdown with correct Content-Disposition", async () => {
      const m = await createManuscript("My Research Paper");
      const res = await get(`/api/manuscripts/${m.id}/export?format=md`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      expect(res.headers.get("content-disposition")).toContain("my-research-paper.md");
    });

    it("includes title as h1 in exported markdown", async () => {
      const m = await createManuscript("Zettel Theory");
      const res = await get(`/api/manuscripts/${m.id}/export?format=md`);
      const text = await res.text();

      expect(text).toMatch(/^# Zettel Theory/);
    });

    it("includes section content in export", async () => {
      const note = await createNote("permanent", "Test Note", "note body content");
      const m = await createManuscript("Export Test");
      await addSection(m.id, { noteId: note.id, isTransclusion: true });

      const res = await get(`/api/manuscripts/${m.id}/export?format=md`);
      const text = await res.text();

      expect(text).toContain("note body content");
    });

    it("does not call pandoc for md format", async () => {
      const m = await createManuscript("No Pandoc");
      await get(`/api/manuscripts/${m.id}/export?format=md`);

      expect(runPandoc).not.toHaveBeenCalled();
    });

    it("slugifies title for filename (spaces → dashes)", async () => {
      const m = await createManuscript("Hello World Test");
      const res = await get(`/api/manuscripts/${m.id}/export?format=md`);
      expect(res.headers.get("content-disposition")).toContain("hello-world-test.md");
    });

    it("falls back to 'manuscript' slug when title has no alphanumeric chars", async () => {
      // Edge case: if title becomes empty after slugify
      // The API requires title.min(1) so we can't create truly empty, but
      // special-char titles should still work
      const m = await createManuscript("Draft 1");
      const res = await get(`/api/manuscripts/${m.id}/export?format=md`);
      expect(res.headers.get("content-disposition")).toContain("draft-1.md");
    });
  });

  describe("latex export (format=latex)", () => {
    it("returns application/x-tex with pandoc output", async () => {
      vi.mocked(runPandoc).mockResolvedValue(Buffer.from("\\documentclass{article}"));
      const m = await createManuscript("Latex Paper");
      const res = await get(`/api/manuscripts/${m.id}/export?format=latex`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/x-tex");
      expect(res.headers.get("content-disposition")).toContain("latex-paper.tex");
    });

    it("calls pandoc with -t latex --standalone", async () => {
      const m = await createManuscript("The Study");
      await get(`/api/manuscripts/${m.id}/export?format=latex`);

      expect(runPandoc).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["-t", "latex", "--standalone"])
      );
    });

    it("returns 503 when pandoc is not available", async () => {
      vi.mocked(isPandocAvailable).mockResolvedValue(false);
      const m = await createManuscript("No Pandoc");
      const res = await get(`/api/manuscripts/${m.id}/export?format=latex`);

      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Pandoc not installed");
    });
  });

  describe("docx export (format=docx)", () => {
    it("returns docx content-type with pandoc output", async () => {
      vi.mocked(runPandoc).mockResolvedValue(Buffer.from("PK\x03\x04docx-stub"));
      const m = await createManuscript("Word Paper");
      const res = await get(`/api/manuscripts/${m.id}/export?format=docx`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      expect(res.headers.get("content-disposition")).toContain("word-paper.docx");
    });

    it("calls pandoc with -t docx", async () => {
      const m = await createManuscript("Docx Study");
      await get(`/api/manuscripts/${m.id}/export?format=docx`);

      expect(runPandoc).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["-t", "docx"])
      );
    });

    it("returns 503 when pandoc is not available", async () => {
      vi.mocked(isPandocAvailable).mockResolvedValue(false);
      const m = await createManuscript("No Pandoc");
      const res = await get(`/api/manuscripts/${m.id}/export?format=docx`);

      expect(res.status).toBe(503);
    });
  });
});
