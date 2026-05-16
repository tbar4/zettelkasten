import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  httpOllamaClient,
  isOllamaAvailable,
  resetOllamaAvailability
} from "../src/lib/ollama-client";

// Helper: build a ReadableStream from NDJSON lines
function ndjsonStream(objects: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = objects.map((o) => JSON.stringify(o)).join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    }
  });
}

describe("httpOllamaClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("POSTs to /api/chat with stream:true and yields content chunks", async () => {
    const ndjson = [
      { message: { content: "Hello" }, done: false },
      { message: { content: ", world" }, done: false },
      { message: { content: "!" }, done: true }
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(ndjsonStream(ndjson), {
        status: 200,
        headers: { "content-type": "application/x-ndjson" }
      })
    );

    const client = httpOllamaClient("http://localhost:11434");
    const tokens: string[] = [];
    for await (const chunk of client.chat([{ role: "user", content: "Hi" }])) {
      tokens.push(chunk);
    }

    expect(tokens).toEqual(["Hello", ", world", "!"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"stream":true')
      })
    );
  });

  it("uses the default model from env-like default", async () => {
    const ndjson = [{ message: { content: "ok" }, done: true }];
    fetchMock.mockResolvedValueOnce(
      new Response(ndjsonStream(ndjson), { status: 200 })
    );

    const client = httpOllamaClient();
    for await (const _ of client.chat([{ role: "user", content: "test" }])) {
      // consume
    }

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      model: string;
    };
    expect(body.model).toBe("qwen2.5:7b-instruct");
  });

  it("uses a custom model when opts.model is provided", async () => {
    const ndjson = [{ message: { content: "ok" }, done: true }];
    fetchMock.mockResolvedValueOnce(
      new Response(ndjsonStream(ndjson), { status: 200 })
    );

    const client = httpOllamaClient();
    for await (const _ of client.chat([{ role: "user", content: "test" }], {
      model: "llama3:8b"
    })) {
      // consume
    }

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      model: string;
    };
    expect(body.model).toBe("llama3:8b");
  });

  it("handles chunked delivery across multiple reads", async () => {
    const encoder = new TextEncoder();
    const part1 = encoder.encode('{"message":{"content":"chunk');
    const part2 = encoder.encode('1"},"done":false}\n{"message":{"content":"chunk2"},"done":true}\n');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(part1);
        controller.enqueue(part2);
        controller.close();
      }
    });

    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const client = httpOllamaClient();
    const tokens: string[] = [];
    for await (const chunk of client.chat([{ role: "user", content: "test" }])) {
      tokens.push(chunk);
    }
    expect(tokens).toEqual(["chunk1", "chunk2"]);
  });

  it("throws when Ollama returns a non-200 status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    const client = httpOllamaClient();
    await expect(async () => {
      for await (const _ of client.chat([{ role: "user", content: "test" }])) {
        // consume
      }
    }).rejects.toThrow("Ollama error: 502");
  });
});

describe("isOllamaAvailable", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    resetOllamaAvailability();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("returns true when /api/tags responds with 200", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const result = await isOllamaAvailable("http://localhost:11434");
    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.any(Object)
    );
  });

  it("returns false when /api/tags fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await isOllamaAvailable("http://localhost:11434");
    expect(result).toBe(false);
  });

  it("memoizes the result on subsequent calls", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await isOllamaAvailable("http://localhost:11434");
    await isOllamaAvailable("http://localhost:11434");
    // fetch should only be called once due to memoization
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
