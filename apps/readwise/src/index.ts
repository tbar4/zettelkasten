import { env, dbUrl } from "./env";
import { readwiseClient } from "./client";
import { runSync } from "./sync";

if (!env.READWISE_TOKEN) {
  console.error(
    "readwise: READWISE_TOKEN not set — worker cannot sync. Exiting."
  );
  process.exit(1);
}

const client = readwiseClient({
  token: env.READWISE_TOKEN,
  baseUrl: env.READWISE_BASE_URL
});

let inFlight = false;

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await runSync(dbUrl(), client);
    if (result.highlightsInserted > 0 || result.sourcesUpserted > 0) {
      console.log(
        `readwise: synced ${result.sourcesUpserted} sources, ${result.highlightsInserted} new highlights`
      );
    }
  } catch (err) {
    console.error("readwise: sync failed:", err);
  } finally {
    inFlight = false;
  }
}

console.log(
  `readwise: starting (interval=${env.READWISE_INTERVAL_MS}ms)`
);

void tick();
setInterval(tick, env.READWISE_INTERVAL_MS);
