# M3 Plan 5: Personal re-ranker

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** A 2-layer MLP re-ranks the top-K candidates from embedding retrieval based on the user's accept/reject signal. Cold-start uses raw embedding rank until 30 feedback events accumulate.

**Architecture:** New `suggestion_feedback` table records user actions on related-notes/ask citations. Python ML service grows two endpoints: `POST /rerank` (inference) and `POST /train-reranker` (online update). Training is triggered by a Node cron every 50 new events or nightly. Model file lives in `apps/ml/data/reranker.pt`.

**Tech stack:** PyTorch in `apps/ml/`. New table via migration `0007_suggestion_feedback.sql`.

---

## Tasks

### Task 1: Migration + schema
- `apps/api/src/db/migrations/0007_suggestion_feedback.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS "suggestion_feedback" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "from_note_id" uuid REFERENCES "note"("id") ON DELETE CASCADE,
    "to_note_id" uuid NOT NULL REFERENCES "note"("id") ON DELETE CASCADE,
    "action" text NOT NULL CHECK ("action" IN ('accepted', 'rejected', 'dismissed')),
    "surfaced_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "suggestion_feedback_to_idx" ON "suggestion_feedback"("to_note_id");
  ```
- Add to `packages/db-schema/src/schema.ts`
- Update `_journal.json`
- Add `suggestion_feedback` to TRUNCATE list in `apps/api/tests/setup.ts`
- Commit: `feat(db): suggestion_feedback table`

### Task 2: Feedback API
- `apps/api/src/routes/suggestion-feedback.ts`:
  - `POST /api/suggestion-feedback` — body: `{fromNoteId?, toNoteId, action, surfacedAt}`. Returns count of accumulated events.
  - `GET /api/suggestion-feedback/count` — returns total event count (used to gate cold-start)
- Mount in `server.ts`
- Tests
- Commit: `feat(api): suggestion-feedback collection endpoint`

### Task 3: Wire feedback into UI
- In `RelatedNotesPanel.tsx`: track when a card is shown (surfacedAt) and emit `suggestion_feedback` when clicked (accepted). Add ✕ button per card → "rejected".
- In `ask.tsx` citations: same pattern — clicking a citation = accepted, dismiss button = dismissed.
- Commit: `feat(web): suggestion-feedback collection in related-notes + ask`

### Task 4: Python re-ranker
- `apps/ml/src/reranker.py`:
  - PyTorch MLP class: input dim = 5 (cosine_sim, shared_tags_count, same_type_flag, link_density_ratio, temporal_proximity_days). Two hidden layers (32, 16), ReLU, sigmoid output.
  - `class Reranker:`
    - `__init__(model_path: str)` — loads weights if file exists, else initializes random.
    - `score(features: list[list[float]]) -> list[float]` — inference.
    - `train_step(features: list[list[float]], labels: list[int])` — mini-batch SGD update (label=1 for accepted, 0 for rejected/dismissed).
    - `save()` — write to model_path.
- `apps/ml/src/main.py`: add `POST /rerank` (input: list of feature vectors, output: scores) and `POST /train-reranker` (input: features + labels, calls train_step + save).
- Tests: `apps/ml/tests/test_reranker.py` — verify train_step changes weights, score is in [0, 1], save+reload round-trips.
- Commit: `feat(ml): mlp re-ranker (inference + train_step)`

### Task 5: Training trigger + feature extraction
- New worker `apps/reranker-worker/` (small):
  - Polls `/api/suggestion-feedback/count`. When delta-since-last-train >= 50 OR daily timer fires, fetches all feedback rows, computes features per row by querying the DB for: cosine similarity (via embedding join), shared tags count, same-type flag, link density, time delta. Sends to `/train-reranker`.
  - Stores last-train cursor in a new `ml_state` table (small: `key text PK, value text`). Or just track in memory + a file at `apps/ml/data/last_train_count.txt`. File is fine for a personal app.
- For now skip the full cron; just expose a manual trigger: `POST /api/ml/retrain-reranker` that the user can curl. The worker can be added later — the file does the cron part in M3 Plan 6 or beyond.
- Commit: `feat(api): /api/ml/retrain-reranker manual trigger`

### Task 6: Re-rank in semantic search + related-notes
- Modify `apps/api/src/routes/search.ts` semantic and related endpoints:
  - After fetching top-K from pgvector, build feature vectors for each candidate (same features as training).
  - Call `POST /rerank` on the ML service. If feedback count < 30, skip re-rank (cold-start) — just return raw embedding order.
  - If ML service down, also fall back to raw order.
  - Re-order candidates by rerank scores.
- Add `usingReranker: boolean` to the response so the UI can show a "ML re-ranking" indicator.
- Tests update
- Commit: `feat(api): rerank top-K results when feedback threshold met`

### Task 7: E2E
- Typecheck + tests + README update
- Commit cleanup

## Conventions
- Feature extraction lives server-side (in `apps/api`), not in the ML service — keeps Python service stateless.
- All ML calls fail gracefully (raw order fallback).
- Don't add cron infrastructure this plan — manual retrain endpoint is enough.
