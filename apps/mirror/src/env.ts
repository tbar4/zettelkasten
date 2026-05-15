import { z } from "zod";
import { homedir } from "os";
import { join } from "path";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://zk:zk@localhost:5433/zettel"),
  DATABASE_URL_TEST: z
    .string()
    .url()
    .default("postgres://zk:zk@localhost:5433/zettel_test"),
  ZK_MIRROR_DIR: z.string().default(join(homedir(), "Notes", "zettel")),
  ZK_MIRROR_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000)
});

const raw = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  ZK_MIRROR_DIR: process.env.ZK_MIRROR_DIR,
  ZK_MIRROR_INTERVAL_MS: process.env.ZK_MIRROR_INTERVAL_MS
};

export const env = EnvSchema.parse(raw);

export function dbUrl(): string {
  return env.NODE_ENV === "test" ? env.DATABASE_URL_TEST : env.DATABASE_URL;
}
