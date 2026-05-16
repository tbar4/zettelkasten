import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { healthRoute } from "./routes/health";
import { notesRoute } from "./routes/notes";
import { linksRoute, noteLinksRoute } from "./routes/links";
import { tagsRoute, noteTagsRoute } from "./routes/tags";
import { graphRoute } from "./routes/graph";
import { reviewRoute } from "./routes/review";
import { inboxRoute } from "./routes/inbox";
import { highlightsRoute } from "./routes/highlights";
import { notionRoute } from "./routes/notion";
import { customLinkTypesRoute } from "./routes/custom-link-types";
import { canvasesRoute } from "./routes/canvases";
import { manuscriptsRoute } from "./routes/manuscripts";
import { manuscriptExportsRoute } from "./routes/manuscript-exports";
import { sourcesRoute } from "./routes/sources";
import { mlRoute } from "./routes/ml";
import { searchRoute } from "./routes/search";
import { askRoute } from "./routes/ask";
import { suggestionFeedbackRoute } from "./routes/suggestion-feedback";

export const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors({ origin: "http://localhost:5173" }));

app.route("/health", healthRoute);
app.route("/api/notes", notesRoute);
app.route("/api/notes", noteLinksRoute);
app.route("/api/links", linksRoute);
app.route("/api/tags", tagsRoute);
app.route("/api/notes", noteTagsRoute);
app.route("/api/notes", reviewRoute);
app.route("/api/graph", graphRoute);
app.route("/api/inbox", inboxRoute);
app.route("/api/highlights", highlightsRoute);
app.route("/api/notion", notionRoute);
app.route("/api/custom-link-types", customLinkTypesRoute);
app.route("/api/canvases", canvasesRoute);
app.route("/api/manuscripts", manuscriptsRoute);
app.route("/api/manuscripts", manuscriptExportsRoute);
app.route("/api/sources", sourcesRoute);
app.route("/api/ml", mlRoute);
app.route("/api/search", searchRoute);
app.route("/api/notes", searchRoute);
app.route("/api/ask", askRoute);
app.route("/api/suggestion-feedback", suggestionFeedbackRoute);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "internal" }, 500);
});
