import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "../../packages/db-schema/src/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://zk:zk@localhost:5433/zettel"
  },
  strict: true,
  verbose: true
});
