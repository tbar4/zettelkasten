import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { dbUrl } from "../env";

const sql = postgres(dbUrl(), { max: 10 });

export const db = drizzle(sql, { schema, logger: false });
export type DB = typeof db;
export { sql as pgClient };
