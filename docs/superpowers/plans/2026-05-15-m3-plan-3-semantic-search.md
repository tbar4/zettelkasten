# M3 Plan 3: Semantic search + related-notes panel

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** Semantic search mode in `/search` and ⌘K (toggle between text + semantic). Related-notes panel in NoteEditor right rail driven by embedding cosine similarity.

**Architecture:** New API endpoints proxy to the ML service for query embedding, then run pgvector cosine-distance queries against the `embedding` table. Top-K results returned. Web adds a toggle in the command palette and a new editor-rail panel.

**Tech stack:** Reuses Plan 2 ML service.

---

## Tasks

### Task 1: ML service query endpoint
- In `apps/ml/src/main.py`, add `POST /embed-query` — same as `/embed` but always returns a single vector. Optionally just reuse `/embed` (it already takes a list — pass `[query]`, take vectors[0]).
- Skip new endpoint; use `/embed` with `[query]`. No code change needed in Python service.

### Task 2: Semantic search API
- New file `apps/api/src/routes/search.ts` (or extend existing search route — find it). Add:
  - `GET /api/search/semantic?q=...&limit=10` — embed the query via ML service, run `SELECT note.* FROM embedding JOIN note ON note.id = embedding.note_id ORDER BY embedding.vector <=> $queryVector LIMIT $limit` (note: `<=>` is cosine distance in pgvector). Returns notes with a `similarity` score (1 - distance).
  - `GET /api/notes/:id/related?limit=8` — fetch the note's embedding, then run same query but exclude self.
- Both endpoints gracefully return `{results: [], reason: "no-embedding"}` when the source note has no embedding OR the query embed fails (ML service down).
- Tests: `apps/api/tests/semantic-search.test.ts` with a mock ML client; seed a few notes with stubbed embeddings (manually inserted rows in the embedding table) and verify ordering.
- Commit: `feat(api): semantic search and related-notes endpoints`

### Task 3: API client
- Add `searchSemantic(q, limit?)`, `getRelatedNotes(noteId, limit?)` to `apps/web/src/lib/api-client.ts`
- Tests
- Commit: `feat(web): api client semantic search methods`

### Task 4: Command palette toggle
- Existing command palette is `apps/web/src/components/CommandPalette.tsx` (find it; M1 Plan 3).
- Add a small toggle: "Text" | "Semantic" (default Text). When semantic is active, debounce 250ms and call `searchSemantic`; otherwise use the existing FTS path.
- When semantic returns `reason: "no-embedding"`, show "ML embedding not ready — try again soon" in the empty state.
- Update tests
- Commit: `feat(web): semantic search toggle in command palette`

### Task 5: Related notes panel
- New component `apps/web/src/components/RelatedNotesPanel.tsx`. Props: `{ noteId: string }`.
- Calls `getRelatedNotes(noteId)`, shows top 8 as clickable cards (title + type + similarity %).
- Mount in `apps/web/src/routes/notes.$noteId.tsx` right rail (alongside backlinks).
- Hide entirely when API returns `reason: "no-embedding"`.
- Test
- Commit: `feat(web): related-notes panel in note editor`

### Task 6: E2E
- Typecheck + tests
- Commit cleanup if needed

## Conventions
- pgvector cosine distance via `<=>` operator. Use `sql\`${embedding.vector} <=> ${queryVecLiteral}::vector\`` or pass vector as parameter via `sql.raw` carefully — pgvector accepts `'[1,2,3]'::vector` text format.
- ML service URL: `process.env.ML_SERVICE_URL ?? "http://localhost:8000"`
- Graceful degradation: if ML service returns non-2xx or network errors, return `{results: [], reason: "ml-unavailable"}` from the API. Never crash the API.
