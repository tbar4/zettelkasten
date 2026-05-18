import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const BASE = process.env.POSTGRES_BASE_URL ?? "postgres://zk:zk@localhost:5433";
const TEST_DBS = [
  "zettel_test",
  "zettel_test_readwise",
  "zettel_test_embedding",
  "zettel_test_mirror"
];

async function ensureDb(name: string): Promise<void> {
  const admin = postgres(`${BASE}/postgres`, { max: 1 });
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${name}"`);
      console.log(`Created database ${name}`);
    }
  } finally {
    await admin.end();
  }
}

async function ensureExtensions(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  } finally {
    await sql.end();
  }
}

async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  for (const name of TEST_DBS) {
    const url = `${BASE}/${name}`;
    await ensureDb(name);
    await ensureExtensions(url);
    console.log(`Migrating ${name}`);
    await runMigrations(url);
  }
  console.log("All test databases ready.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
