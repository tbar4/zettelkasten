import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://zk:zk@localhost:5432/zettel"),
  DATABASE_URL_TEST: z
    .string()
    .url()
    .default("postgres://zk:zk@localhost:5432/zettel_test"),
  PORT: z.coerce.number().int().positive().default(3001)
});

const raw = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  PORT: process.env.PORT
};

export const env = EnvSchema.parse(raw);

export function dbUrl(): string {
  return env.NODE_ENV === "test" ? env.DATABASE_URL_TEST : env.DATABASE_URL;
}
