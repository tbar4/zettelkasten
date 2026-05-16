# M3 Plan 2: ML service scaffold + embeddings worker

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** Add a Python FastAPI ML service that produces text embeddings, a Node worker that calls it on note changes, and an `embedding` table (pgvector) keyed by note.

**Architecture:** New service at `apps/ml/` runs FastAPI + sentence-transformers. Exposed at `http://localhost:8000`. The Node embedding worker (`apps/embedding-worker/`) polls for notes that need re-embedding (no row, or `note.updated_at > embedding.generated_at`), calls `POST /embed`, writes the vector to `embedding` table. Migration `0006_embeddings.sql` adds the table.

**Tech stack:** Python 3.12, FastAPI, sentence-transformers, uvicorn. Node embedding-worker reuses existing TS/Drizzle setup. Model: `nomic-embed-text-v1.5` (768-dim).

**Local-only note:** Don't add the ML service to docker-compose this plan — it needs Metal/GPU access. Document running it natively (`uvicorn apps.ml.main:app --port 8000`). M3 Plan 4 (Ollama RAG) will follow the same pattern.

---

## Tasks

### Task 1: Migration for embedding table
- `apps/api/src/db/migrations/0006_embeddings.sql`:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS "embedding" (
    "note_id" uuid PRIMARY KEY REFERENCES "note"("id") ON DELETE CASCADE,
    "vector" vector(768) NOT NULL,
    "model_version" text NOT NULL,
    "generated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "embedding_vector_idx" ON "embedding" USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);
  ```
- Update `meta/_journal.json` (idx 6, tag `0006_embeddings`)
- Add `embedding` table to `packages/db-schema/src/schema.ts` using a custom `vector` type:
  ```ts
  const vector768 = customType<{ data: number[]; driverData: string }>({
    dataType() { return "vector(768)"; },
    fromDriver(v: string) { return JSON.parse(v); },
    toDriver(v: number[]) { return `[${v.join(",")}]`; }
  });
  export const embeddings = pgTable("embedding", { ... });
  ```
- Add `embedding` to `apps/api/tests/setup.ts` TRUNCATE list
- Run migrations (dev + test)
- Commit: `feat(db): embedding table with pgvector (768-dim)`

### Task 2: Python ML service scaffold
- New dir `apps/ml/`:
  - `apps/ml/pyproject.toml` — Python 3.12, deps: `fastapi`, `uvicorn`, `sentence-transformers`, `pydantic`, `pytest`, `httpx`
  - `apps/ml/src/main.py` — FastAPI app with one endpoint:
    - `POST /embed` — body: `{texts: string[]}` → response: `{vectors: number[][], modelVersion: string}`
    - Model: `nomic-embed-text-v1.5` via `SentenceTransformer`. Lazy-load on first call (memo at module level). Always-on healthcheck at `GET /health`.
  - `apps/ml/src/embedder.py` — extracted embedder class with `embed(texts: list[str]) -> tuple[list[list[float]], str]`. Returns (vectors, "nomic-embed-text-v1.5"). Easier to test if separated.
  - `apps/ml/tests/test_embedder.py` — use a tiny stub: monkeypatch `SentenceTransformer` to a fake that returns deterministic arrays based on input length, then verify the endpoint shape.
  - `apps/ml/README.md` — instructions: `pip install -e .` then `uvicorn apps.ml.src.main:app --port 8000`. Note: first run downloads ~270 MB model.
- Commit: `feat(ml): fastapi service with /embed endpoint`

### Task 3: Embedding worker
- New dir `apps/embedding-worker/`:
  - `package.json`: name `@zk/embedding-worker`, deps: postgres, drizzle-orm, `@zk/db-schema`. Devdeps: typescript, vitest, tsx.
  - `src/index.ts` — entry point: connect to DB, loop forever (poll every 60s + on startup):
    1. Query notes where no embedding row OR `embedding.generated_at < note.updated_at`. Batch size: 32.
    2. For each batch: POST to `http://localhost:8000/embed` with `{texts: [note.bodyMd || note.title for note in batch]}`. Fail-loudly if ML service down (log + sleep 60s + retry; don't crash).
    3. For each returned vector: UPSERT embedding row.
  - `src/sync.ts` — the core function `runSync(db, mlClient): Promise<{embedded: number}>`. Pure logic, testable.
  - `tests/sync.test.ts` — mock the ML client; verify it processes pending notes, skips up-to-date ones, batches correctly.
  - Add to root `package.json` scripts: `dev:embedding-worker`: `pnpm --filter @zk/embedding-worker dev`
- Commit: `feat(embedding-worker): polls notes and writes embeddings`

### Task 4: API endpoint to expose embeddings status
- In `apps/api/src/routes/notes.ts` (or new `apps/api/src/routes/ml.ts`): add `GET /api/ml/embedding-status` returning `{total: int, embedded: int, stale: int}` for the UI to show progress
- Test it
- Commit: `feat(api): /api/ml/embedding-status endpoint`

### Task 5: Web UI status badge
- Add a small "ML" status indicator to `__root.tsx` nav: tooltip shows "X of Y notes embedded"
- Polls every 30s via TanStack Query
- Commit: `feat(web): ml embedding status badge in nav`

### Task 6: README + E2E
- Update README: new section "ML service" with how to run, model download note, optional dependency
- Run typecheck + test suite
- Commit: `docs: ml service setup instructions`

## Conventions
- Don't add ML service to docker-compose this plan (needs Metal access)
- Python tests run separately: `cd apps/ml && pytest`. Don't try to add Python to `pnpm test`.
- The embedding worker should be optional — if ML service is down, the rest of the app must work fine.
- If sentence-transformers download/install is impossible in subagent environment, write the Python code anyway and gate tests behind a `SKIP_ML_DOWNLOAD` env var. The implementation just needs to be correct; whether the model loads in CI is secondary.
