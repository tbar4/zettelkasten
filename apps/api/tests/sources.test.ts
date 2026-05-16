import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function createSource(opts: {
  title: string;
  author?: string;
  sourceType?: string;
  url?: string;
  isbn?: string;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.sources)
    .values({
      title: opts.title,
      author: opts.author ?? null,
      sourceType: opts.sourceType ?? null,
      url: opts.url ?? null,
      isbn: opts.isbn ?? null
    })
    .returning({ id: schema.sources.id });
  return { id: row!.id };
}

describe("GET /api/sources/bibtex", () => {
  it("returns 200 with text/x-bibtex content type", async () => {
    const res = await app.request("/api/sources/bibtex", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/x-bibtex");
  });

  it("returns attachment content-disposition with .bib filename", async () => {
    const res = await app.request("/api/sources/bibtex", { method: "GET" });
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain("attachment");
    expect(cd).toContain("zettel-bibliography.bib");
  });

  it("returns empty body when no sources exist", async () => {
    const res = await app.request("/api/sources/bibtex", { method: "GET" });
    expect(await res.text()).toBe("");
  });

  it("returns BibTeX entries for existing sources", async () => {
    await createSource({ title: "Clean Code 2008", author: "Robert Martin", isbn: "978-0-13-235088-4" });
    const res = await app.request("/api/sources/bibtex", { method: "GET" });
    const text = await res.text();
    expect(text).toContain("@book{martin-2008");
    expect(text).toContain("title = {{Clean Code 2008}}");
    expect(text).toContain("isbn = {978-0-13-235088-4}");
  });

  it("returns multiple entries separated by double newline", async () => {
    await createSource({ title: "First Book 2021", author: "Alice" });
    await createSource({ title: "Second Article 2022", author: "Bob", sourceType: "article" });
    const res = await app.request("/api/sources/bibtex", { method: "GET" });
    const text = await res.text();
    expect(text).toContain("@misc{alice-2021");
    expect(text).toContain("@article{bob-2022");
    expect(text).toContain("\n\n@");
  });

  it("includes source id in note field for traceability", async () => {
    const { id } = await createSource({ title: "Traceable Source" });
    const res = await app.request("/api/sources/bibtex", { method: "GET" });
    const text = await res.text();
    expect(text).toContain(`note = {${id}}`);
  });
});
