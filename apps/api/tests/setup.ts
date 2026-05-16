import { beforeAll, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "@zk/db-schema";

process.env.NODE_ENV = "test";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(() => {
  client = postgres(url, { max: 5 });
  db = drizzle(client, { schema });
});

beforeEach(async () => {
  // Wipe data between tests. TRUNCATE CASCADE keeps schema, drops rows.
  await db.execute(
    rawSql`TRUNCATE TABLE manuscript_section, manuscript, canvas_edge, canvas_item, canvas, note_source, highlight, source, spaced_review, note_tag, note_link, custom_link_type, tag, embedding, note RESTART IDENTITY CASCADE`
  );
});

afterAll(async () => {
  await client.end();
});
