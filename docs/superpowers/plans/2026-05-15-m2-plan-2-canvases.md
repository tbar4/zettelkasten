# M2 Plan 2: Topic canvases (Excalidraw)

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** A `/topics/:noteId/canvas` route where the user drags note cards onto an Excalidraw canvas and persists scene + items + edges.

**Architecture:** Excalidraw embedded via `@excalidraw/excalidraw`. Scene JSON stored in `canvas.scene_data`; note cards persisted as `canvas_item` rows (so we can query "which canvases reference this note"); freeform edges as `canvas_edge` rows. On scene change, debounce 1.5s, then PATCH the scene; item drag/create/delete are separate API calls so they stay queryable.

**Tech stack:** `@excalidraw/excalidraw`, React, TanStack Router + Query.

---

## Tasks

### Task 1: Install Excalidraw
- `pnpm --filter @zk/web add @excalidraw/excalidraw`
- Commit: `chore(web): add @excalidraw/excalidraw`

### Task 2: Canvas API
- `apps/api/src/routes/canvases.ts` with:
  - `GET /api/canvases/by-topic/:topicNoteId` — returns canvas row (creates one if missing for a topic note), with items and edges
  - `PATCH /api/canvases/:id` — update sceneData, viewport, theme
  - `POST /api/canvases/:id/items` — body: { noteId, x, y, width?, height?, color? }
  - `PATCH /api/canvases/items/:itemId` — body: { x?, y?, width?, height?, color?, zIndex? }
  - `DELETE /api/canvases/items/:itemId`
  - `POST /api/canvases/:id/edges` — body: { fromItemId, toItemId, label?, color? }
  - `DELETE /api/canvases/edges/:edgeId`
- Validate topicNoteId actually points to a `note` of type `topic` (404 otherwise)
- Mount at `/api/canvases` in `server.ts`
- Tests: `apps/api/tests/canvases.test.ts` — get-or-create, item CRUD, edge CRUD, only-topic-notes guard
- Commit: `feat(api): /api/canvases routes for topic canvas persistence`

### Task 3: API client methods
- Add `canvasByTopic(topicNoteId)`, `updateCanvas(id, patch)`, `addCanvasItem(canvasId, body)`, `updateCanvasItem(itemId, patch)`, `deleteCanvasItem(itemId)`, `addCanvasEdge(canvasId, body)`, `deleteCanvasEdge(edgeId)` to `apps/web/src/lib/api-client.ts`
- Tests in `apps/web/tests/api-client-canvas.test.ts`
- Commit: `feat(web): api client methods for canvas operations`

### Task 4: TopicCanvas component
- `apps/web/src/components/TopicCanvas.tsx`
- Props: `{ topicNoteId: string }`
- Fetches canvas via TanStack Query, renders `<Excalidraw>` with `initialData` from `scene_data`
- onChange handler: debounces 1.5s, PATCHes sceneData + viewport
- Provides a "note card" sidebar inside the canvas: dropdown to pick any non-topic note + "Add to canvas" button → POSTs a canvas_item
- Renders existing canvas_items as Excalidraw custom rectangle elements with note title as label; clicking a card opens that note in a new tab (or navigates)
- Renders canvas_edges as Excalidraw arrow elements between items
- Use `useMemo` for the Excalidraw `initialData` so it doesn't re-mount on every render
- Commit: `feat(web): TopicCanvas component with Excalidraw embed`

### Task 5: Route + nav
- `apps/web/src/routes/topics.$noteId.canvas.tsx` → `/topics/:noteId/canvas`
- Uses TopicCanvas
- Add an "Open canvas" button to NoteEditor topbar that's only visible when `note.type === "topic"`, navigates to the canvas route
- Add link in `__root.tsx` nav: "Canvases" → opens a `/topics` index? Actually no — canvases are per-topic so just rely on the editor button. Skip extra nav.
- Commit: `feat(web): /topics/:noteId/canvas route + editor entry point`

### Task 6: E2E
- `pnpm -r typecheck` clean
- `pnpm -r --workspace-concurrency=1 test` — all green
- Commit if any fixes needed: `chore: M2 Plan 2 cleanup`

## Conventions
- Same conventions as Plan 1 (drizzle array-form, db: any tx pattern, no comments unless WHY)
- Excalidraw is heavy; lazy-load via `React.lazy` if it bloats the bundle
- The canvas route should NOT be in the mobile PWA (Plan 5)
