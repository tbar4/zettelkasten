import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { zodErrorHook } from "../lib/zod-error-hook";
import { httpMlClient, type MLClient } from "../lib/ml-client";
import {
  httpOllamaClient,
  isOllamaAvailable,
  resetOllamaAvailability,
  type OllamaClient,
  type Message
} from "../lib/ollama-client";

// Dependency injection for testing
let _mlClient: MLClient | null = null;
let _ollamaClient: OllamaClient | null = null;

export function setAskMlClient(client: MLClient | null): void {
  _mlClient = client;
}

export function setAskOllamaClient(client: OllamaClient | null): void {
  _ollamaClient = client;
}

export { resetOllamaAvailability };

function getMlClient(): MLClient {
  if (_mlClient) return _mlClient;
  const baseUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  return httpMlClient(baseUrl);
}

function getOllamaClient(): OllamaClient {
  if (_ollamaClient) return _ollamaClient;
  const baseUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  return httpOllamaClient(baseUrl);
}

export const askRoute = new Hono();

const AskBodySchema = z.object({
  question: z.string().min(1),
  k: z.number().int().min(1).max(50).default(12)
});

interface CitationNote {
  id: string;
  title: string;
  type: string;
  similarity: number;
}

interface NoteWithBody extends CitationNote {
  bodyMd: string | null;
}

const SYSTEM_PROMPT = `You are a research assistant answering questions strictly from the user's zettelkasten notes.
Cite every claim with [[Note Title]] referencing the notes provided.
If the notes do not contain enough information to answer, say so and decline to fabricate.`;

/**
 * POST /api/ask
 *
 * Embeds the question, retrieves top-K similar notes, then streams an
 * SSE response with:
 *   { type: "citations", notes: [...] }      — first event
 *   { type: "token", value: "..." }           — per LLM token
 *   { type: "done" }                          — final
 *   { type: "error", message: "..." }         — on failure
 */
askRoute.post(
  "/",
  zValidator("json", AskBodySchema, zodErrorHook),
  async (c) => {
    // Check Ollama availability first (before starting SSE stream)
    const ollamaOk = await isOllamaAvailable(
      process.env.OLLAMA_URL ?? "http://localhost:11434"
    );
    if (!ollamaOk) {
      return c.json({ error: "Ollama not available" }, 503);
    }

    const { question, k } = c.req.valid("json");

    return streamSSE(c, async (stream) => {
      try {
        // 1. Embed the question
        let queryVector: number[];
        try {
          const mlClient = getMlClient();
          const { vectors } = await mlClient.embed([question]);
          queryVector = vectors[0]!;
        } catch {
          await stream.writeSSE({
            data: JSON.stringify({ type: "error", message: "ML service unavailable" })
          });
          return;
        }

        // 2. Retrieve top-K notes by cosine similarity
        const vecLiteral = `[${queryVector.join(",")}]`;

        const rows = await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL ivfflat.probes = 100`);
          return tx.execute<{
            id: string;
            title: string;
            type: string;
            similarity: number;
            body_md: string | null;
          }>(sql`
            SELECT n.id, n.title, n.type, n.body_md,
                   1 - (e.vector <=> ${vecLiteral}::vector) AS similarity
            FROM embedding e
            JOIN note n ON n.id = e.note_id
            WHERE n.archived_at IS NULL
            ORDER BY e.vector <=> ${vecLiteral}::vector
            LIMIT ${k}
          `);
        });

        const notes: NoteWithBody[] = rows.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          similarity: Number(r.similarity),
          bodyMd: r.body_md
        }));

        // 3. Emit citations event (id, title, type, similarity only)
        const citations: CitationNote[] = notes.map(({ id, title, type, similarity }) => ({
          id,
          title,
          type,
          similarity
        }));
        await stream.writeSSE({
          data: JSON.stringify({ type: "citations", notes: citations })
        });

        // 4. Build LLM messages
        const noteContext = notes
          .map((n) => {
            const excerpt = n.bodyMd ? n.bodyMd.slice(0, 1000) : "(no body)";
            return `## [[${n.title}]]\n${excerpt}`;
          })
          .join("\n\n");

        const messages: Message[] = [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${question}\n\nRelevant notes:\n${noteContext}`
          }
        ];

        // 5. Stream LLM tokens
        const ollamaClient = getOllamaClient();
        for await (const token of ollamaClient.chat(messages)) {
          await stream.writeSSE({
            data: JSON.stringify({ type: "token", value: token })
          });
        }

        // 6. Done
        await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await stream.writeSSE({
          data: JSON.stringify({ type: "error", message })
        });
      }
    });
  }
);
