import { Hono } from "hono";
import { Client } from "@notionhq/client";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/client";
import { zodErrorHook } from "../lib/zod-error-hook";
import { makeNotionClient } from "../notion/client";
import { buildPreview, commitImport } from "../notion/import";

export const notionRoute = new Hono();

const PreviewRequest = z.object({
  token: z.string().min(1),
  databaseId: z.string().min(1)
});

notionRoute.post(
  "/preview",
  zValidator("json", PreviewRequest, zodErrorHook),
  async (c) => {
    const { token, databaseId } = c.req.valid("json");
    const client = makeNotionClient(new Client({ auth: token }));
    const preview = await buildPreview(client, databaseId);
    return c.json(preview);
  }
);

const NoteTypeEnum = z.enum([
  "fleeting",
  "literature",
  "permanent",
  "topic"
]);

const CommitPage = z.object({
  notionPageId: z.string(),
  title: z.string(),
  body: z.string(),
  type: NoteTypeEnum
});

const CommitRequest = z.object({
  pages: z.array(CommitPage)
});

notionRoute.post(
  "/commit",
  zValidator("json", CommitRequest, zodErrorHook),
  async (c) => {
    const { pages } = c.req.valid("json");
    const result = await commitImport(db, pages);
    return c.json(result);
  }
);
