import { env } from "./env";

console.log(
  `mirror: configured for ${env.ZK_MIRROR_DIR} every ${env.ZK_MIRROR_INTERVAL_MS}ms`
);
console.log("mirror: sweep loop not implemented yet (Task 10)");
