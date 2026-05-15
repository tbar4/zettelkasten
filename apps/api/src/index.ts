import { serve } from "@hono/node-server";
import { app } from "./server";
import { env } from "./env";

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
