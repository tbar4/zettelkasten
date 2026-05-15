import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dbUrl } from "../env";

async function main() {
  const url = dbUrl();
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  console.log(`Migrating ${url.replace(/:[^:@]*@/, ":***@")}`);
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await sql.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
