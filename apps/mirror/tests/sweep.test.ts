import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql, eq } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { runSweep } from "../src/sweep";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

let mirrorDir = "";

beforeEach(async () => {
  await db.execute(
    rawSql`TRUNCATE TABLE note_source, highlight, source, spaced_review, note_tag, note_link, tag, note RESTART IDENTITY CASCADE`
  );
  if (mirrorDir) await rm(mirrorDir, { recursive: true, force: true });
  mirrorDir = await mkdtemp(join(tmpdir(), "zk-mirror-"));
});

afterAll(async () => {
  if (mirrorDir) await rm(mirrorDir, { recursive: true, force: true });
  await client.end();
});

describe("runSweep", () => {
  it("writes a file for each non-archived note", async () => {
    const [a] = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "A Note", bodyMd: "hello" })
      .returning();
    const result = await runSweep(url, mirrorDir);
    expect(result.written).toBe(1);
    expect(result.deleted).toBe(0);

    const files = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("a-note");
    expect(files[0]).toContain(a!.id.slice(0, 8));

    const content = await readFile(join(mirrorDir, files[0]!), "utf8");
    expect(content).toContain("type: permanent");
    expect(content).toContain('title: "A Note"');
    expect(content).toContain("hello");
  });

  it("deletes the file when a note is archived", async () => {
    const [a] = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "X", bodyMd: "y" })
      .returning();
    await runSweep(url, mirrorDir);
    expect((await readdir(mirrorDir)).filter((f) => f.endsWith(".md"))).toHaveLength(1);

    await db
      .update(schema.notes)
      .set({ archivedAt: new Date() })
      .where(eq(schema.notes.id, a!.id));
    const result = await runSweep(url, mirrorDir);
    expect(result.deleted).toBe(1);
    expect((await readdir(mirrorDir)).filter((f) => f.endsWith(".md"))).toEqual([]);
  });

  it("rewrites the file when title changes (old removed, new written)", async () => {
    const [a] = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Old Title" })
      .returning();
    await runSweep(url, mirrorDir);
    const before = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    expect(before[0]).toContain("old-title");

    await db
      .update(schema.notes)
      .set({ title: "New Title" })
      .where(eq(schema.notes.id, a!.id));
    await runSweep(url, mirrorDir);
    const after = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    expect(after).toHaveLength(1);
    expect(after[0]).toContain("new-title");
    expect(after[0]).not.toContain("old-title");
  });

  it("does not rewrite a file when content is unchanged", async () => {
    await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Stable", bodyMd: "x" })
      .returning();
    await runSweep(url, mirrorDir);
    const files = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
    const fsPromises = await import("fs/promises");
    const mtimeBefore = (
      await fsPromises.stat(join(mirrorDir, files[0]!))
    ).mtimeMs;

    await new Promise((r) => setTimeout(r, 50));

    await runSweep(url, mirrorDir);
    const mtimeAfter = (
      await fsPromises.stat(join(mirrorDir, files[0]!))
    ).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });
});
