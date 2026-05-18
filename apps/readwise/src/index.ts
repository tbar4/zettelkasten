import { env, dbUrl } from "./env";
import { readwiseClient } from "./client";
import { runSync } from "./sync";

if (!env.READWISE_TOKEN) {
  // Stay up so `docker compose up` doesn't crash-loop. Drop a token into .env
  // and `docker compose restart readwise` to enable sync.
  console.log(
    "readwise: READWISE_TOKEN not set — idling. Set the token in .env and restart this service to enable sync."
  );
  // Keep the event loop alive forever without spinning the CPU.
  setInterval(() => {}, 1 << 30);
} else {
  const client = readwiseClient({
    token: env.READWISE_TOKEN,
    baseUrl: env.READWISE_BASE_URL
  });

  let inFlight = false;

  const tick = async (): Promise<void> => {
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
  };

  console.log(`readwise: starting (interval=${env.READWISE_INTERVAL_MS}ms)`);

  void tick();
  setInterval(() => void tick(), env.READWISE_INTERVAL_MS);
}
