# M2 Plan 3: Manuscripts view + transclusion

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** Three-pane composition surface at `/manuscripts/:id` for assembling notes into long-form drafts. Sections can transclude a note (live-mirror) or copy it (frozen snapshot).

**Architecture:** `manuscript` + `manuscript_section` tables already exist from Plan 1. API exposes ordered sections. Web UI is three panes: (left) note picker filtered by anchor topics, (center) ordered section list with drag-reorder, (right) references auto-collected from transcluded/copied notes.

**Tech stack:** Hono, Drizzle, TanStack Router + Query, React DnD via `@dnd-kit/core` if not present (else fall back to plain "move up/move down" buttons — choice up to implementer).

---

## Tasks

### Task 1: Manuscripts API
- `apps/api/src/routes/manuscripts.ts`:
  - `GET /api/manuscripts` — list all manuscripts (id, title, anchor count, section count, updatedAt)
  - `POST /api/manuscripts` — body: { title, anchorTopicIds?: string[] }
  - `GET /api/manuscripts/:id` — returns manuscript + sections (with note title joined when noteId set, in `position` order)
  - `PATCH /api/manuscripts/:id` — title, anchorTopicIds, bodyMd
  - `DELETE /api/manuscripts/:id`
  - `POST /api/manuscripts/:id/sections` — body: { position?, noteId?, isTransclusion?, heading?, frozenBodyMd? }. If `noteId` + `isTransclusion=false`, server snapshots the current `note.bodyMd` into `frozenBodyMd`.
  - `PATCH /api/manuscripts/sections/:sectionId` — body: { position?, heading?, isTransclusion?, frozenBodyMd? }. Toggling `isTransclusion: true → false` re-snapshots from the linked note's current bodyMd.
  - `DELETE /api/manuscripts/sections/:sectionId`
- Validate `anchorTopicIds` all reference topic-type notes
- Mount in `server.ts`
- Tests: `apps/api/tests/manuscripts.test.ts` — list, create, get, patch, delete, section add (transclude + copy), section reorder, copy-snapshot-freezes, toggle-to-copy-snapshots
- Add `manuscript_section, manuscript` to `apps/api/tests/setup.ts` TRUNCATE list
- Commit: `feat(api): /api/manuscripts routes with transclusion + copy`

### Task 2: API client
- Add manuscript methods to `apps/web/src/lib/api-client.ts`: `listManuscripts`, `createManuscript`, `getManuscript`, `updateManuscript`, `deleteManuscript`, `addManuscriptSection`, `updateManuscriptSection`, `deleteManuscriptSection`
- Tests in `apps/web/tests/api-client-manuscripts.test.ts`
- Commit: `feat(web): api client methods for manuscripts`

### Task 3: Manuscripts index route
- `apps/web/src/routes/manuscripts.index.tsx` → `/manuscripts` (TanStack `manuscripts/index` pattern; if dot+`index` doesn't work, name it `manuscripts.tsx` mapped to `/manuscripts`)
- Lists manuscripts, "+ New manuscript" button with title prompt
- Add nav link to `__root.tsx`: "Manuscripts" → `/manuscripts`
- Commit: `feat(web): /manuscripts index route`

### Task 4: ManuscriptView component (three panes)
- `apps/web/src/components/ManuscriptView.tsx`
- Props: `{ manuscriptId: string }`
- Left rail: shows notes linked from any of the manuscript's `anchorTopicIds` (use existing `GET /api/notes/:id/links` to gather), grouped by `linkType`, with a search box that filters by title substring
- Center: ordered section list. Each section: heading (editable), source note title (or "Free-form" if no noteId), body preview (transcluded note's bodyMd OR `frozenBodyMd`), per-section actions: "Move up", "Move down", "Toggle transclude/copy", "Delete"
- Right rail: deduped list of all notes referenced by sections (their titles + types)
- "Add section" footer: dropdown of notes from left rail with "Transclude" and "Copy" buttons; "Add free-form section" button creates a section with no noteId and an editable `frozenBodyMd`
- Use TanStack Query for fetch + mutations
- Commit: `feat(web): ManuscriptView three-pane composition surface`

### Task 5: Detail route
- `apps/web/src/routes/manuscripts.$manuscriptId.tsx` → `/manuscripts/:manuscriptId`
- Renders `ManuscriptView` with a title-edit input and an anchor-topic picker
- Commit: `feat(web): /manuscripts/:id detail route`

### Task 6: E2E
- `pnpm -r typecheck` clean
- `pnpm -r --workspace-concurrency=1 test` — all green

## Conventions
- Same Drizzle 0.36 + Hono + db:any conventions from prior plans
- The `position` column is an integer; use sparse spacing (e.g., multiples of 10) so reorders don't require shifting every section. When inserting between A (pos=10) and B (pos=20), use pos=15. When the gap is exhausted, server transparently re-spaces all positions for that manuscript.
