import { z } from "zod";

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
  READWISE_TOKEN: z.string().optional(),
  READWISE_BASE_URL: z.string().default("https://readwise.io/api/v2"),
  READWISE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(6 * 60 * 60 * 1000)
});

const raw = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  READWISE_TOKEN: process.env.READWISE_TOKEN,
  READWISE_BASE_URL: process.env.READWISE_BASE_URL,
  READWISE_INTERVAL_MS: process.env.READWISE_INTERVAL_MS
};

export const env = EnvSchema.parse(raw);

export function dbUrl(): string {
  return env.NODE_ENV === "test" ? env.DATABASE_URL_TEST : env.DATABASE_URL;
}
