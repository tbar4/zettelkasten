import { Hono } from "hono";
import { asc } from "drizzle-orm";
import { db } from "../db/client";
import { sources } from "@zk/db-schema";
import { sourcesToBibtex } from "../sources/bibtex";

export const sourcesRoute = new Hono();

sourcesRoute.get("/bibtex", async (c) => {
  const rows = await db.select().from(sources).orderBy(asc(sources.createdAt));
  const bib = sourcesToBibtex(rows);
  return new Response(bib, {
    headers: {
      "content-type": "text/x-bibtex; charset=utf-8",
      "content-disposition": 'attachment; filename="zettel-bibliography.bib"'
    }
  });
});
