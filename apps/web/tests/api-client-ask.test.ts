import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";
import type { AskEvent } from "../src/lib/api-client";

/** Build a ReadableStream of SSE-encoded events */
function buildSSEStream(events: AskEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = events
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  });
}

describe("api.ask()", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("POSTs to /api/ask with question and yields parsed events", async () => {
    const sseEvents: AskEvent[] = [
      { type: "citations", notes: [{ id: "n1", title: "Note A", type: "permanent", similarity: 0.95 }] },
      { type: "token", value: "Hello" },
      { type: "token", value: " world" },
      { type: "done" }
    ];

    fetchMock.mockResolvedValueOnce(
      new Response(buildSSEStream(sseEvents), {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    );

    const received: AskEvent[] = [];
    for await (const evt of api.ask("What is knowledge?")) {
      received.push(evt);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ask",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("What is knowledge?")
      })
    );
    expect(received).toHaveLength(4);
    expect(received[0]).toMatchObject({ type: "citations" });
    expect((received[0] as { type: "citations"; notes: unknown[] }).notes).toHaveLength(1);
    expect(received[1]).toMatchObject({ type: "token", value: "Hello" });
    expect(received[2]).toMatchObject({ type: "token", value: " world" });
    expect(received[3]).toMatchObject({ type: "done" });
  });

  it("includes k in request body when provided", async () => {
    const sseEvents: AskEvent[] = [{ type: "done" }];
    fetchMock.mockResolvedValueOnce(
      new Response(buildSSEStream(sseEvents), { status: 200 })
    );

    for await (const _ of api.ask("test", { k: 5 })) {
      // consume
    }

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
    ) as { question: string; k: number };
    expect(body.k).toBe(5);
  });

  it("throws on non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Ollama not available" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(async () => {
      for await (const _ of api.ask("test")) {
        // consume
      }
    }).rejects.toThrow("Ollama not available");
  });

  it("yields error events from the stream", async () => {
    const sseEvents: AskEvent[] = [
      { type: "error", message: "ML service unavailable" }
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(buildSSEStream(sseEvents), { status: 200 })
    );

    const received: AskEvent[] = [];
    for await (const evt of api.ask("test")) {
      received.push(evt);
    }
    expect(received[0]).toMatchObject({ type: "error", message: "ML service unavailable" });
  });

  it("handles chunked SSE delivery across multiple reads", async () => {
    const encoder = new TextEncoder();
    // Split "data: ..." across two chunks
    const chunk1 = encoder.encode('data: {"type":"token","value":"hel');
    const chunk2 = encoder.encode('lo"}\n\ndata: {"type":"done"}\n\n');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      }
    });

    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const received: AskEvent[] = [];
    for await (const evt of api.ask("test")) {
      received.push(evt);
    }
    expect(received[0]).toMatchObject({ type: "token", value: "hello" });
    expect(received[1]).toMatchObject({ type: "done" });
  });
});

describe("api.askDraft()", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("POSTs to /api/ask/draft and returns draft text", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ draft: "Atomic claim here." }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await api.askDraft({
      question: "What is knowledge?",
      answer: "Knowledge is justified true belief.",
      citedNoteIds: ["id1", "id2"]
    });

    expect(result.draft).toBe("Atomic claim here.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ask/draft",
      expect.objectContaining({ method: "POST" })
    );
  });
});
