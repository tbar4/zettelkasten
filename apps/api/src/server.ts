import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { healthRoute } from "./routes/health";

export const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors({ origin: "http://localhost:5173" }));

app.route("/health", healthRoute);
