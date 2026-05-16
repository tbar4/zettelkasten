/**
 * Ollama client — wraps the local Ollama HTTP API for chat completions.
 * Supports streaming via NDJSON (one JSON object per line).
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaClient {
  chat(messages: Message[], opts?: { model?: string }): AsyncIterable<string>;
}

const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";
const DEFAULT_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

/** Memoized availability check — resets when process restarts. */
let _available: boolean | null = null;

export async function isOllamaAvailable(baseUrl = DEFAULT_URL): Promise<boolean> {
  if (_available !== null) return _available;
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    _available = res.ok;
  } catch {
    _available = false;
  }
  return _available;
}

/** Reset the memoized availability (for testing). */
export function resetOllamaAvailability(): void {
  _available = null;
}

export function httpOllamaClient(baseUrl = DEFAULT_URL): OllamaClient {
  return {
    async *chat(messages: Message[], opts?: { model?: string }): AsyncIterable<string> {
      const model = opts?.model ?? DEFAULT_MODEL;
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: true })
      });

      if (!res.ok) {
        throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error("Ollama returned no response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // NDJSON: split on newlines, process complete lines
        const lines = buffer.split("\n");
        // Last element may be incomplete — keep it in buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const obj = JSON.parse(trimmed) as {
            message?: { content?: string };
            done?: boolean;
          };
          if (obj.message?.content) {
            yield obj.message.content;
          }
          if (obj.done) break;
        }
      }

      // Process any remaining buffer content
      if (buffer.trim()) {
        const obj = JSON.parse(buffer.trim()) as {
          message?: { content?: string };
          done?: boolean;
        };
        if (obj.message?.content) {
          yield obj.message.content;
        }
      }
    }
  };
}
