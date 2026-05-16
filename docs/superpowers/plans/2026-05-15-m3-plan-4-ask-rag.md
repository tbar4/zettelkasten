# M3 Plan 4: /ask RAG surface (Ollama)

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** A `/ask` page where the user asks a question and the system retrieves top-K relevant notes via embedding similarity, sends them to a local Ollama LLM with a citation-enforcement system prompt, and streams back an answer with `[[note-title]]` citations.

**Architecture:** New API endpoint `POST /api/ask` accepts `{question, k?}`, embeds the question via ML service, retrieves top-12 notes via pgvector, sends to Ollama with strict prompt. Streams the LLM response back via SSE. Citations rendered as wikilinks in the UI. "Draft as permanent note" button takes the answer + cited notes and prompts the LLM to produce a single atomic claim.

**Tech stack:** Ollama (assumed running at `http://localhost:11434`), SSE for streaming. No new web deps.

---

## Tasks

### Task 1: Ollama client
- `apps/api/src/lib/ollama-client.ts`
- `interface OllamaClient { chat(messages: Message[], opts?: { model?: string }): AsyncIterable<string> }`
- Wraps `POST /api/chat` with `stream: true`. Parses NDJSON response line-by-line, yields `message.content` chunks.
- Default model: `qwen2.5:7b-instruct` (per design spec); configurable via env `OLLAMA_MODEL`.
- Default URL: `http://localhost:11434`; configurable via env `OLLAMA_URL`.
- Health check: `isOllamaAvailable()` memoized — does a `GET /api/tags` to verify.
- Tests in `apps/api/tests/ollama-client.test.ts` — mock fetch + verify NDJSON streaming parses correctly.
- Commit: `feat(api): ollama client with streaming chat`

### Task 2: Ask endpoint
- `apps/api/src/routes/ask.ts`:
  - `POST /api/ask` — body: `{question: string, k?: number = 12}`. Returns SSE stream:
    - First event: `{type: "citations", notes: [{id, title, type, similarity}]}` — the retrieved top-K
    - Subsequent events: `{type: "token", value: "..."}`
    - Final event: `{type: "done"}`
    - On error: `{type: "error", message: "..."}`
- Embeds question, fetches top-K via pgvector (same query as Plan 3 semantic search), builds system prompt:
  ```
  You are a research assistant answering questions strictly from the user's zettelkasten notes.
  Cite every claim with [[Note Title]] referencing the notes provided.
  If the notes do not contain enough information to answer, say so and decline to fabricate.
  ```
- User message: question + a section "Relevant notes:" with each note's title + body excerpt (max 1000 chars per note).
- Returns 503 with `{error: "Ollama not available"}` if `isOllamaAvailable()` is false.
- Tests in `apps/api/tests/ask.test.ts` — mock Ollama client + ML client; verify citations are emitted, tokens stream, error path.
- Commit: `feat(api): /api/ask RAG endpoint with citation enforcement`

### Task 3: API client
- Add `ask(question, opts?): AsyncIterable<AskEvent>` to `apps/web/src/lib/api-client.ts` that consumes the SSE stream.
- Tests
- Commit: `feat(web): api client ask method (SSE)`

### Task 4: Ask route
- `apps/web/src/routes/ask.tsx` → `/ask`
- UI: textarea for question, "Ask" button. On submit, streams answer to a markdown-rendered area with `[[Note Title]]` rendered as clickable links (route to that note).
- Citations panel above answer: cards with title + similarity + click-to-open.
- "Draft as permanent note" button below: posts a follow-up to `/api/ask/draft` that prompts the LLM to write a single atomic claim citing the same notes (in the user's voice). Result opens in a new editor pane (prefilled new note form).
- Add nav link
- Commit: `feat(web): /ask route with streaming answer + citation links`

### Task 5: Draft-as-note endpoint
- `POST /api/ask/draft` — body: `{question: string, answer: string, citedNoteIds: string[]}`. Calls Ollama with a different system prompt:
  ```
  Rewrite the following Q&A as a single atomic claim in the user's first-person voice.
  Keep it under 200 words. Preserve [[wikilink]] citations.
  ```
- Returns plain text (the draft). Not streaming.
- Wire into the web Ask page's "Draft as permanent note" button — opens `/notes/new?body=<draft>&type=permanent`. (If `notes/new` doesn't exist as a route, fall back to creating the note directly via the existing POST /api/notes and navigating to its editor.)
- Commit: `feat(api): /api/ask/draft generates a permanent-note draft`

### Task 6: E2E
- Typecheck + tests
- README: document Ollama dependency + recommended model
- Commit cleanup

## Conventions
- Streaming: use Hono's `streamSSE` helper for SSE. Look at Hono docs if needed.
- Graceful degradation: every Ollama-dependent path returns 503 with a clear message when unavailable.
- Don't actually call Ollama in tests — mock the client.
- Citation rendering: regex `\[\[([^\]]+)\]\]` + resolve title to noteId via API (or just route to a search-by-title page).
