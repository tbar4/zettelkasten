# M3 Plan 6: Lit-note classifier + ML-driven daily review (M3 feature-complete)

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** XGBoost classifier predicts promote-worthiness for Readwise highlights (shown as confidence chip). Daily review ranking switches from M1's pure time-decay to a hybrid score (embedding distance to recently-edited notes + re-ranker preference + time decay). Declares M3 feature-complete.

**Architecture:** New `highlight_promotion_feedback` table records every promote/edit/reject action on highlights. Python ML service grows `/score-highlight` and `/train-classifier` endpoints. Daily review ranking moves server-side into a new endpoint that combines signals.

**Tech stack:** XGBoost in `apps/ml/`. Migration `0008_classifier_review.sql`.

---

## Tasks

### Task 1: Migration
- `0008_classifier_review.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS "highlight_promotion_feedback" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "highlight_id" uuid REFERENCES "highlight"("id") ON DELETE CASCADE,
    "action" text NOT NULL CHECK ("action" IN ('promoted', 'edited', 'rejected')),
    "draft_text" text,
    "final_text" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE INDEX IF NOT EXISTS "highlight_promotion_feedback_h_idx" ON "highlight_promotion_feedback"("highlight_id");
  ```
- Schema update + journal + TRUNCATE list
- Commit: `feat(db): highlight_promotion_feedback table`

### Task 2: Feedback collection
- `apps/api/src/routes/highlight-feedback.ts`:
  - `POST /api/highlight-feedback` — body: `{highlightId, action, draftText?, finalText?}`
  - `GET /api/highlight-feedback/count`
- Wire into the highlight promotion flow in `apps/web/src/routes/inbox.tsx`: when user promotes a highlight, send `action: "promoted"` with `draftText` (highlight body) + `finalText` (the body they kept). When they dismiss/archive, send `action: "rejected"`.
- Commit: `feat(api+web): highlight promotion feedback`

### Task 3: XGBoost classifier
- Add `xgboost` to `apps/ml/pyproject.toml`
- `apps/ml/src/classifier.py`:
  - Features (7-dim): `text_length`, `has_note` (highlight.noteText present), `color_score` (yellow=0.3, blue=0.5, pink=0.7, green=0.9, null=0.1 — picks an arbitrary ordering), `embedding_distance_to_recent_permanent` (cosine distance between highlight text embedding and centroid of last-30-day permanent notes, default 0.5 if no embedding), `source_type_score` (book=0.7, article=0.5, other=0.3), `hour_of_day_normalized` (created_at hour / 24), `per_source_prior_promotion_rate` (default 0.3 if source has no history).
  - `Classifier`:
    - `__init__(model_path)` — loads XGBClassifier if file exists, else None.
    - `score(features) -> list[float]` — returns probability, or 0.5 if no model.
    - `train(features, labels)` — train XGBClassifier, save.
- ML service endpoints: `POST /score-highlights` (list of feature vectors → scores), `POST /train-classifier` (features + labels). Returns no-op if < 50 events to avoid training noise.
- Tests
- Commit: `feat(ml): xgboost highlight promotion classifier`

### Task 4: Highlights inbox uses score
- New API: `GET /api/inbox/highlights` — extend the existing endpoint to include `promotionScore: number | null` from a JOIN/CALL into ML service. Or do this client-side via the ml-client.
- Sort highlights by promotion score DESC when score is present.
- `inbox.tsx`: render the confidence chip on each highlight (color-graded).
- Commit: `feat(api+web): highlight promotion confidence in inbox`

### Task 5: ML-driven daily review
- New endpoint `GET /api/inbox/review` (replaces the M1 spaced-repetition simple-time-decay implementation):
  - Compute candidate set: all permanent notes with `spaced_review.next_due_at <= now()` OR no `spaced_review` row.
  - For each candidate, compute score = `0.5 * base_time_decay + 0.3 * embedding_distance_to_recently_edited + 0.2 * reranker_score_if_available`.
  - `base_time_decay = 1 - exp(-days_since_last_seen / 14)`.
  - `embedding_distance_to_recently_edited` = cosine distance from this note to the centroid of last-7-day-edited notes. Lower distance = more relevant = higher score.
  - `reranker_score` = use the reranker from Plan 5 if feedback ≥ 30, else 0.
  - Return top-20 sorted by score.
- The existing inbox `review` pane consumes this new endpoint.
- Tests
- Commit: `feat(api): ml-driven daily review ranking replaces time-decay`

### Task 6: README + M3 feature-complete
- Update README "Current status" to declare **M3 feature-complete**, mention all ML features
- Document: ML service install, Ollama setup, embedding worker, optional retrain endpoints
- Commit: `docs: M3 feature-complete (lit-note classifier + ml-driven review)`

### Task 7: E2E
- Typecheck + tests
- Final commit if needed

## Conventions
- Same as prior plans; graceful ML fallback everywhere; cold-start gates.
- LoRA opt-in is deferred (post-M3 nice-to-have).
- Tests can use small fake feature matrices; xgboost trains in microseconds on small datasets.
