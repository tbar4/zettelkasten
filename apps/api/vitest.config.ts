import { defineConfig } from "vitest/config";
import { execSync } from "child_process";

// On macOS with Docker Desktop, Postgres.app may intercept localhost:5432.
// Use the host's LAN IP to reach the Docker container directly.
function dockerHost(): string {
  try {
    const ip = execSync("ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'", { encoding: "utf8" }).trim();
    if (ip && ip !== "localhost") return ip;
  } catch {
    // ignore
  }
  return "localhost";
}

const host = process.env.PG_HOST ?? (process.platform === "darwin" ? dockerHost() : "localhost");

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true }
    },
    env: {
      DATABASE_URL: `postgres://zk:zk@${host}:5432/zettel`,
      DATABASE_URL_TEST: `postgres://zk:zk@${host}:5432/zettel_test`
    }
  }
});
