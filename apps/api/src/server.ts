import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { healthRoute } from "./routes/health";
import { notesRoute } from "./routes/notes";

export const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors({ origin: "http://localhost:5173" }));

app.route("/health", healthRoute);
app.route("/api/notes", notesRoute);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "internal" }, 500);
});
