import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5432/zettel_test";

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

describe("schema", () => {
  it("inserts and retrieves a permanent note", async () => {
    const [inserted] = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Hello", bodyMd: "world" })
      .returning();
    expect(inserted!.title).toBe("Hello");

    const rows = await db
      .select()
      .from(schema.notes)
      .where(eq(schema.notes.id, inserted!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bodyMd).toBe("world");
  });

  it("rejects body_md on topic notes via CHECK constraint", async () => {
    await expect(
      db
        .insert(schema.notes)
        .values({ type: "topic", title: "Topic", bodyMd: "forbidden" })
    ).rejects.toThrow();
  });

  it("rejects self-links via CHECK constraint", async () => {
    const [n] = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "A" })
      .returning();
    await expect(
      db
        .insert(schema.noteLinks)
        .values({ fromNoteId: n!.id, toNoteId: n!.id, linkType: "references" })
    ).rejects.toThrow();
  });
});
