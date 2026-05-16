# Zettelkasten ML Service

FastAPI service that produces text embeddings using `nomic-embed-text-v1.5` (768-dim).

## Setup

```bash
cd apps/ml
pip install -e ".[dev]"
```

> **First run note:** The sentence-transformers model (`nomic-ai/nomic-embed-text-v1.5`) is approximately 270 MB and will be downloaded automatically on first use from HuggingFace.

## Running

```bash
# From the repo root:
uvicorn apps.ml.src.main:app --port 8000 --reload

# Or from apps/ml:
cd apps/ml
uvicorn src.main:app --port 8000 --reload
```

The service runs at `http://localhost:8000`.

## Endpoints

- `GET /health` — health check, returns `{"status": "ok"}`
- `POST /embed` — embed texts
  - Request: `{"texts": ["text 1", "text 2"]}`
  - Response: `{"vectors": [[...768 floats...], ...], "modelVersion": "nomic-ai/nomic-embed-text-v1.5"}`

## Running tests

```bash
cd apps/ml
pytest
```

Tests monkeypatch `SentenceTransformerModel` and do **not** require a model download.

## Architecture note

This service is intentionally **not** in `docker-compose.yml` because it needs Metal/GPU access on Apple Silicon. Run it natively. The embedding worker (`apps/embedding-worker/`) is fault-tolerant — if this service is down, the rest of the app continues to work.
