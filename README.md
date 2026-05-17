# Zettelkasten

Personal web-based zettelkasten with auto-graph, topic canvases, and local ML. Single-user, runs on a home Mac behind Tailscale.

See [`docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md`](docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md) for design and [`docs/superpowers/plans/`](docs/superpowers/plans/) for implementation plans.

## Current status

**M1 + M2 + M3 Plan 2 complete.** The stack supports note + link + tag CRUD, a CodeMirror 6 markdown editor with `[[wikilink]]` autocomplete and decoration, a backlinks panel with note titles, inline tag editing, a ⌘K command palette over Postgres FTS, a Sigma.js graph view at `/graph`, a triage inbox at `/inbox` with spaced-repetition daily review, fleeting-note promotion, and Readwise-highlight promotion, a markdown mirror worker that writes every note to `~/Notes/zettel/` with git auto-commits, a Readwise sync worker that pulls highlights into the inbox, a one-shot Notion importer at `/import/notion` that converts pages to typed notes with bulk re-typing and mention-to-wikilink rewriting, a Manuscript editor with transclusion/copy sections, manuscript export to Markdown, LaTeX, and DOCX (via Pandoc), a mobile PWA at `/m/` with offline capture, and a local ML embedding pipeline (FastAPI + sentence-transformers + pgvector).

## Mobile

The app is installable as a PWA (Chrome/Safari on iOS/Android, or desktop Chrome). After installing, it opens to `/m/capture`.

- **`/m/capture`** — Full-screen mobile capture: type a thought and tap Save. If you're offline (or the request fails), the note is queued in IndexedDB. The queue flushes automatically every 30 seconds and whenever the device comes back online.
- **`/m/inbox`** — Mobile triage inbox: fleeting notes and Readwise highlights, tap to expand and act (promote / archive). Actions open the desktop editor in a new tab.

The mobile shell (`/m/`) renders a bottom tab bar (Capture / Inbox) and suppresses the desktop nav header. Offline writes are handled by an IndexedDB outbox (`idb` library, `zk-outbox` database).

## Setup

Prerequisites: Node 22, pnpm 9+, Docker Desktop. **Optional:** [Pandoc](https://pandoc.org/installing.html) for LaTeX and DOCX manuscript export.

```bash
pnpm install
pnpm db:up                              # postgres + redis
pnpm --filter @zk/api db:migrate
pnpm db:migrate:test                                # creates + migrates per-package test DBs
pnpm dev:api                            # http://localhost:3001
pnpm dev:web                            # http://localhost:5173
pnpm dev:mirror                         # writes notes to ~/Notes/zettel and auto-commits
pnpm dev:readwise                       # readwise sync (requires READWISE_TOKEN env var)
pnpm dev:embedding-worker               # embedding worker (optional — requires ML service running)
```

**Note on Postgres port:** the container exposes `localhost:5433` (not `5432`) to avoid conflicts with `Postgres.app` on macOS.

## ML service

The embedding pipeline runs a local Python FastAPI service (`apps/ml/`) using `nomic-embed-text-v1.5` (768-dim) via sentence-transformers.

**This service is intentionally not in `docker-compose.yml`** — it needs Metal/GPU access on Apple Silicon and must run natively.

### Setup

```bash
cd apps/ml
pip install -e ".[dev]"
# First run downloads ~270 MB model from HuggingFace
uvicorn src.main:app --port 8000 --reload
```

### Running the embedding worker

With the ML service running on `http://localhost:8000`:

```bash
pnpm dev:embedding-worker
```

The worker polls every 60s for notes that need (re-)embedding and writes 768-dim vectors to the `embedding` table. If the ML service is down, the worker logs an error and retries — the rest of the app is unaffected.

### Embedding status

The nav shows a live "ML X/Y" badge (polls every 30s from `/api/ml/embedding-status`). Amber = stale embeddings pending, green = all up to date.

### Python tests

```bash
cd apps/ml
pip install -e ".[dev]"
pytest
```

Tests monkeypatch `SentenceTransformerModel` — no model download needed.

## Tests

```bash
pnpm test                               # all packages
pnpm --filter @zk/api test              # api only
```

## Layout

- `apps/api` — Hono + Drizzle API
- `apps/web` — React + Vite SPA
- `apps/mirror` — markdown mirror worker (notes → `~/Notes/zettel/`, git auto-commit)
- `apps/readwise` — Readwise sync worker (highlights → inbox)
- `apps/ml` — Python FastAPI ML service (text embeddings via sentence-transformers)
- `apps/embedding-worker` — Node.js worker that polls notes and writes embeddings to Postgres
- `packages/shared` — Zod schemas shared across frontend and backend
- `packages/db-schema` — Drizzle schema shared by api, mirror, readwise, embedding-worker
- `docker-compose.yml` — Postgres (with pgvector + pg_trgm), Redis
