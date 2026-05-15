import { env, dbUrl } from "./env";
import { runSweep } from "./sweep";

let inFlight = false;

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await runSweep(dbUrl(), env.ZK_MIRROR_DIR);
    if (result.committed) {
      console.log(
        `mirror: wrote ${result.written}, deleted ${result.deleted}, committed`
      );
    }
  } catch (err) {
    console.error("mirror: sweep failed:", err);
  } finally {
    inFlight = false;
  }
}

console.log(
  `mirror: starting (dir=${env.ZK_MIRROR_DIR}, interval=${env.ZK_MIRROR_INTERVAL_MS}ms)`
);

void tick();
setInterval(tick, env.ZK_MIRROR_INTERVAL_MS);
