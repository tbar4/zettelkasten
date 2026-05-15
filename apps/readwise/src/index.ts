import { env } from "./env";

if (!env.READWISE_TOKEN) {
  console.error(
    "readwise: READWISE_TOKEN not set — worker cannot sync. Exiting."
  );
  process.exit(1);
}

console.log(
  `readwise: configured (interval=${env.READWISE_INTERVAL_MS}ms) — sync loop not implemented yet (Task 10)`
);
