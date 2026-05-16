import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { runSync } from "./sync.js";
import { httpMlClient } from "./ml-client.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://zk:zk@localhost:5433/zettel";
const ML_BASE_URL = process.env.ML_BASE_URL ?? "http://localhost:8000";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "60000");

const mlClient = httpMlClient(ML_BASE_URL);

const pgClient = postgres(DATABASE_URL, { max: 2 });
const db = drizzle(pgClient);

let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await runSync(db, mlClient);
    if (result.embedded > 0) {
      console.log(`embedding-worker: embedded ${result.embedded} note(s)`);
    }
  } catch (err) {
    // Log but don't crash — if ML service is down, just retry next tick.
    console.error("embedding-worker: sync failed:", err);
    console.log(`embedding-worker: will retry in ${POLL_INTERVAL_MS}ms`);
  } finally {
    inFlight = false;
  }
}

console.log(
  `embedding-worker: starting (interval=${POLL_INTERVAL_MS}ms, ml=${ML_BASE_URL})`
);

void tick();
setInterval(() => void tick(), POLL_INTERVAL_MS);
