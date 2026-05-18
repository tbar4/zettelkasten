# Zettelkasten

Personal web-based zettelkasten with auto-graph, topic canvases, and local ML. Single-user, runs on a home Mac behind Tailscale.

See [`docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md`](docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md) for design and [`docs/superpowers/plans/`](docs/superpowers/plans/) for implementation plans.

## Current status

**M3 FEATURE-COMPLETE.** All three milestones are done. The stack supports:

- **Notes + graph:** note + link + tag CRUD, CodeMirror 6 markdown editor with `[[wikilink]]` autocomplete, backlinks panel, inline tag editing, ⌘K command palette over Postgres FTS, Sigma.js graph view at `/graph`.
- **Inbox + review:** Triage inbox at `/inbox` with ML-driven daily review (hybrid score = time-decay + embedding distance to recently-edited notes), fleeting-note promotion, and Readwise-highlight promotion with XGBoost promotion-score confidence chips.
- **Workers:** Markdown mirror worker (`~/Notes/zettel/` + git), Readwise sync worker, embedding worker (sentence-transformers + pgvector).
- **Import/export:** One-shot Notion importer, Manuscript editor with transclusion/copy sections, export to Markdown/LaTeX/DOCX (Pandoc).
- **Mobile:** PWA at `/m/` with offline IndexedDB capture queue.
- **ML pipeline (local, no cloud):**
  - Embedding service (FastAPI + nomic-embed-text-v1.5, 768-dim, Apple Silicon / CPU).
  - Semantic search + RAG `/ask` (pgvector cosine distance + Ollama LLM).
  - MLP re-ranker (PyTorch, 5-dim features) trained on suggestion-feedback events.
  - XGBoost highlight classifier (5-dim features) trained on promotion-feedback events; shows confidence chip in inbox.
  - ML-driven daily review ranking (`/api/inbox/review`): hybrid score replaces pure time-decay.

## Mobile

The app is installable as a PWA (Chrome/Safari on iOS/Android, or desktop Chrome). After installing, it opens to `/m/capture`.

- **`/m/capture`** — Full-screen mobile capture: type a thought and tap Save. If you're offline (or the request fails), the note is queued in IndexedDB. The queue flushes automatically every 30 seconds and whenever the device comes back online.
- **`/m/inbox`** — Mobile triage inbox: fleeting notes and Readwise highlights, tap to expand and act (promote / archive). Actions open the desktop editor in a new tab.

The mobile shell (`/m/`) renders a bottom tab bar (Capture / Inbox) and suppresses the desktop nav header. Offline writes are handled by an IndexedDB outbox (`idb` library, `zk-outbox` database).

## Setup

Prerequisites: Docker Desktop. (Node 22 + pnpm only needed for running tests on the host — `pnpm -r test`.) **Optional:** [Pandoc](https://pandoc.org/installing.html) for LaTeX/DOCX manuscript export, native Python ML service for embeddings.

```bash
cp .env.example .env                    # edit to add READWISE_TOKEN etc. (all values optional)
docker compose up                       # brings up postgres, redis, db migrations, api, web, mirror, readwise, embedding-worker
```

Then open <http://localhost:5173>. The api is on `:3001`, postgres on `:5433`, redis on `:6379`.

What you get:
- `postgres` + `redis` — datastores
- `db-init` — one-shot, runs migrations and exits
- `api`, `web`, `mirror`, `readwise`, `embedding-worker` — all hot-reload on file changes (sources are bind-mounted)
- Workers that need optional config (Readwise token, ML service) log "idling" and stay up — no crash loops

To enable a worker after first boot: add the token to `.env` and `docker compose restart <service>`.

### Running tests

Tests run on the host (not in containers). One-time setup:

```bash
pnpm install
pnpm db:migrate:test                    # creates + migrates per-package test DBs
pnpm -r test                            # runs every package's tests in parallel
```

**Note on Postgres port:** the container exposes `localhost:5433` (not `5432`) to avoid conflicts with `Postgres.app` on macOS.

## ML service

The local Python FastAPI service (`apps/ml/`) provides:

| Endpoint | Description |
|---|---|
| `POST /embed` | Text → 768-dim vectors (nomic-embed-text-v1.5) |
| `POST /rerank` | 5-dim feature vectors → MLP re-ranker scores |
| `POST /train-reranker` | One SGD step on suggestion-feedback data |
| `POST /score-highlights` | 5-dim feature vectors → XGBoost promotion-score |
| `POST /train-classifier` | Retrain XGBoost on promotion-feedback data (no-op if < 50 events) |

**This service is intentionally not in `docker-compose.yml`** — it needs Metal/GPU access on Apple Silicon and must run natively.

### Setup

```bash
cd apps/ml

# Create a virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies (includes sentence-transformers, torch, xgboost, scikit-learn)
pip install -e ".[dev]"

# First run downloads ~270 MB nomic-embed-text-v1.5 model from HuggingFace
uvicorn src.main:app --port 8000 --reload
```

### Model persistence

Trained models are written to `apps/ml/data/`:
- `reranker.pt` — MLP re-ranker weights (PyTorch)
- `classifier.pkl` — XGBoost classifier (pickle)

Both files are gitignored. Cold-start behavior: re-ranker returns 0.5, classifier returns 0.5.

### Retrain endpoints

The re-ranker and classifier are retrained automatically via API hooks:
- Re-ranker: `POST /api/ml/retrain-reranker` — called by suggestion-feedback flows
- Classifier: `POST /train-classifier` on the ML service — call after accumulating ≥ 50 promote/reject events

### Running the embedding worker

With the ML service running on `http://localhost:8000`:

```bash
pnpm dev:embedding-worker
```

The worker polls every 60s for notes that need (re-)embedding and writes 768-dim vectors to the `embedding` table. If the ML service is down, the worker logs an error and retries — the rest of the app is unaffected.

### Embedding status

The nav shows a live "ML X/Y" badge (polls every 30s from `/api/ml/embedding-status`). Amber = stale embeddings pending, green = all up to date.

## Ollama (local LLM for /ask)

The `/ask` page uses a local [Ollama](https://ollama.com/) instance for RAG-based Q&A over your notes. Ollama must be running separately — it is not included in `docker-compose.yml`.

### Setup

```bash
# Install Ollama from https://ollama.com
brew install ollama          # macOS via Homebrew
ollama serve                 # starts on http://localhost:11434

# Pull the recommended model
ollama pull qwen2.5:7b-instruct
```

### How it works

1. Your question is embedded via the ML service (same model as search).
2. Top-12 similar notes are retrieved by cosine distance from pgvector.
3. The notes + question are sent to Ollama with a citation-enforcement prompt.
4. The answer streams back via SSE. Citations appear as `[[Note Title]]` links.
5. The "Draft as permanent note" button rewrites the Q&A as a single atomic claim.

### Configuration

| Env var | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | Model to use |
| `ML_SERVICE_URL` | `http://localhost:8000` | ML service base URL |
| `RERANKER_MODEL_PATH` | `apps/ml/data/reranker.pt` | Re-ranker weight path |
| `CLASSIFIER_MODEL_PATH` | `apps/ml/data/classifier.pkl` | XGBoost classifier path |

If Ollama is not running, the `/api/ask` and `/api/ask/draft` endpoints return `503 Ollama not available`. The rest of the app is unaffected. If the ML service is not running, all ML features degrade gracefully (0.5 scores, natural ordering).

### Python tests

```bash
cd apps/ml
source .venv/bin/activate  # if using venv
pip install -e ".[dev]"
pytest
```

Tests monkeypatch model loading — no model download needed. XGBoost trains in microseconds on small test matrices.

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
