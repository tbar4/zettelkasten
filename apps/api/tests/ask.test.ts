import { describe, it, expect, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";
import { setAskMlClient, setAskOllamaClient, resetOllamaAvailability } from "../src/routes/ask";
import type { MLClient } from "../src/lib/ml-client";
import type { OllamaClient } from "../src/lib/ollama-client";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";

const pgClient = postgres(url, { max: 1 });
const db = drizzle(pgClient, { schema });

afterAll(async () => {
  await pgClient.end();
  setAskMlClient(null);
  setAskOllamaClient(null);
});

/** Parse SSE response body into an array of parsed event data objects */
async function parseSSEEvents(res: Response): Promise<unknown[]> {
  const text = await res.text();
  const events: unknown[] = [];
  for (const block of text.split("\n\n")) {
    const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
    if (dataLine) {
      events.push(JSON.parse(dataLine.slice(6)));
    }
  }
  return events;
}

function makeVector(scale: number): number[] {
  return Array.from({ length: 768 }, (_, i) => Math.cos(i * scale));
}

function vecLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function insertNote(title: string, body: string | null = null, type = "fleeting"): Promise<string> {
  const [row] = await db
    .insert(schema.notes)
    .values({ type: type as "fleeting", title, bodyMd: body })
    .returning({ id: schema.notes.id });
  return row!.id;
}

async function insertEmbedding(noteId: string, vec: number[]): Promise<void> {
  await db.execute(rawSql`
    INSERT INTO embedding (note_id, vector, model_version)
    VALUES (${noteId}::uuid, ${vecLiteral(vec)}::vector, 'test-model')
  `);
}

function mockMlClient(vec: number[]): MLClient {
  return {
    async embed(_texts: string[]) { return { vectors: [vec], modelVersion: "test" }; },
    async rerank(features: number[][]) { return { scores: features.map(() => 0.5) }; },
    async trainReranker(_features, _labels) { return { trained: 0, loss: 0 }; }
  };
}

function failingMlClient(): MLClient {
  return {
    async embed(_texts: string[]) { throw new Error("ML down"); },
    async rerank(_features) { throw new Error("ML down"); },
    async trainReranker(_features, _labels) { throw new Error("ML down"); }
  };
}

function mockOllamaClient(tokens: string[]): OllamaClient {
  return {
    async *chat(_messages, _opts) {
      for (const t of tokens) yield t;
    }
  };
}

/** Fake OllamaClient whose health check is also mocked */
async function setAvailable(available: boolean) {
  resetOllamaAvailability();
  // Patch global fetch for the /api/tags check
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!called && url.includes("/api/tags")) {
      called = true;
      globalThis.fetch = orig;
      return available
        ? new Response("{}", { status: 200 })
        : Promise.reject(new Error("ECONNREFUSED"));
    }
    return orig(input, init);
  };
}

describe("POST /api/ask", () => {
  const vecA = makeVector(0.001);

  beforeEach(async () => {
    // Reset dependency injection
    setAskMlClient(null);
    setAskOllamaClient(null);
    resetOllamaAvailability();
  });

  it("returns 400 when question is missing", async () => {
    await setAvailable(true);
    const res = await app.request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "" })
    });
    expect(res.status).toBe(400);
  });

  it("returns 503 when Ollama is unavailable", async () => {
    await setAvailable(false);
    setAskMlClient(mockMlClient(vecA));
    setAskOllamaClient(mockOllamaClient([]));

    const res = await app.request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What is knowledge?" })
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Ollama");
  });

  it("emits citations, tokens, and done events in order", async () => {
    await setAvailable(true);

    const idA = await insertNote("Note Alpha", "Alpha body content here");
    const idB = await insertNote("Note Beta", "Beta body content here");
    await insertEmbedding(idA, vecA);
    await insertEmbedding(idB, makeVector(0.5));

    setAskMlClient(mockMlClient(vecA));
    setAskOllamaClient(mockOllamaClient(["Ans", "wer"]));

    const res = await app.request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Tell me about alpha" })
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await parseSSEEvents(res);

    // First event: citations
    const citations = events[0] as { type: string; notes: { id: string; title: string; type: string; similarity: number }[] };
    expect(citations.type).toBe("citations");
    expect(citations.notes).toHaveLength(2);
    // Top citation should be Alpha (same vector as query)
    expect(citations.notes[0]!.id).toBe(idA);
    expect(citations.notes[0]!.title).toBe("Note Alpha");
    expect(citations.notes[0]!.similarity).toBeGreaterThan(0.9);
    // Citations should NOT include body
    expect(Object.keys(citations.notes[0]!)).not.toContain("bodyMd");

    // Token events
    const tokenEvents = events.filter((e) => (e as { type: string }).type === "token") as { type: string; value: string }[];
    expect(tokenEvents.map((e) => e.value).join("")).toBe("Answer");

    // Final event: done
    const last = events[events.length - 1] as { type: string };
    expect(last.type).toBe("done");
  });

  it("emits error event when ML service fails", async () => {
    await setAvailable(true);
    setAskMlClient(failingMlClient());
    setAskOllamaClient(mockOllamaClient([]));

    const res = await app.request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "test question" })
    });

    // SSE stream starts even if there's an error mid-stream
    expect(res.status).toBe(200);
    const events = await parseSSEEvents(res);
    const errorEvent = events.find((e) => (e as { type: string }).type === "error") as
      | { type: string; message: string }
      | undefined;
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.message).toContain("ML");
  });

  it("respects k parameter", async () => {
    await setAvailable(true);

    const id1 = await insertNote("Note 1", "Body 1");
    const id2 = await insertNote("Note 2", "Body 2");
    const id3 = await insertNote("Note 3", "Body 3");
    await insertEmbedding(id1, vecA);
    await insertEmbedding(id2, makeVector(0.3));
    await insertEmbedding(id3, makeVector(0.6));

    setAskMlClient(mockMlClient(vecA));
    setAskOllamaClient(mockOllamaClient(["ok"]));

    const res = await app.request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "test", k: 2 })
    });

    const events = await parseSSEEvents(res);
    const citations = events[0] as { type: string; notes: unknown[] };
    expect(citations.type).toBe("citations");
    expect(citations.notes).toHaveLength(2);
  });
});

describe("POST /api/ask/draft", () => {
  beforeEach(() => {
    setAskMlClient(null);
    setAskOllamaClient(null);
    resetOllamaAvailability();
  });

  afterAll(() => {
    setAskMlClient(null);
    setAskOllamaClient(null);
  });

  it("returns 503 when Ollama is unavailable", async () => {
    await setAvailable(false);
    setAskOllamaClient(mockOllamaClient(["draft"]));

    const res = await app.request("/api/ask/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "What is knowledge?",
        answer: "Knowledge is justified true belief.",
        citedNoteIds: []
      })
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Ollama");
  });

  it("returns 400 when question is missing", async () => {
    await setAvailable(true);
    setAskOllamaClient(mockOllamaClient([]));

    const res = await app.request("/api/ask/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "", answer: "some answer" })
    });
    expect(res.status).toBe(400);
  });

  it("returns a draft from the Ollama response", async () => {
    await setAvailable(true);
    setAskOllamaClient(mockOllamaClient(["Knowledge is a ", "justified true belief [[Gettier]]."]));

    const res = await app.request("/api/ask/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "What is knowledge?",
        answer: "Knowledge is justified true belief.",
        citedNoteIds: []
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: string };
    expect(body.draft).toBe("Knowledge is a justified true belief [[Gettier]].");
  });
});
