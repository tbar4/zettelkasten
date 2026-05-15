import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { healthRoute } from "./routes/health";
import { notesRoute } from "./routes/notes";
import { linksRoute, noteLinksRoute } from "./routes/links";
import { tagsRoute, noteTagsRoute } from "./routes/tags";

export const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors({ origin: "http://localhost:5173" }));

app.route("/health", healthRoute);
app.route("/api/notes", notesRoute);
app.route("/api/notes", noteLinksRoute);
app.route("/api/links", linksRoute);
app.route("/api/tags", tagsRoute);
app.route("/api/notes", noteTagsRoute);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "internal" }, 500);
});
