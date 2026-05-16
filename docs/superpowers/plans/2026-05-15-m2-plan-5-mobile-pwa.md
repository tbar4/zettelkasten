# M2 Plan 5: Mobile PWA + offline outbox

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** Stripped-down mobile experience at `/m/capture` (single textarea → fleeting note) and `/m/inbox` (fleeting + highlight triage). Offline writes queued in IndexedDB and flushed when online.

**Architecture:** Same SPA, two new routes prefixed `/m/`. Vite-PWA plugin (`vite-plugin-pwa`) handles service worker + manifest. IndexedDB via `idb` (small wrapper). The capture form writes to the API; on network error or `navigator.onLine === false`, it writes to the outbox instead. A background flush attempts pending entries every 30s and on `online` events.

**Tech stack:** `vite-plugin-pwa`, `idb`.

---

## Tasks

### Task 1: Install PWA + IndexedDB deps
- `pnpm --filter @zk/web add vite-plugin-pwa idb`
- Wire `VitePWA` plugin in `apps/web/vite.config.ts` with manifest:
  - name: "Zettel"
  - short_name: "Zettel"
  - theme_color: "#1a1b26" (matches the app)
  - icons: use a minimal SVG → just write a placeholder 192x192 + 512x512 PNG from a generated data URL, OR skip icons (manifest still works).
  - display: standalone
  - start_url: "/m/capture"
- Commit: `chore(web): vite-plugin-pwa + idb`

### Task 2: Outbox module
- `apps/web/src/lib/outbox.ts`
- IndexedDB schema: db name `zk-outbox`, object store `pending` keyed by autoincrement `id`. Records: `{ id, kind: "fleeting-note", body: { title, body_md? }, createdAt }`.
- API: `enqueueNote(payload)`, `listPending()`, `markFlushed(id)`, `clearAll()`
- Test: `apps/web/tests/outbox.test.ts` using `fake-indexeddb` (add dev dep: `pnpm --filter @zk/web add -D fake-indexeddb`). The test imports `fake-indexeddb/auto` before importing outbox to swap in the in-memory polyfill.
- Commit: `feat(web): indexeddb outbox for offline note capture`

### Task 3: Flush worker
- `apps/web/src/lib/outbox-flush.ts`
- `startFlushLoop(api)` — every 30s and on window `online` event: read pending, attempt POST `/api/notes` for each, on success `markFlushed`, on failure leave queued.
- Returns a cleanup function.
- Test in `apps/web/tests/outbox-flush.test.ts`
- Commit: `feat(web): outbox flush loop`

### Task 4: Capture route
- `apps/web/src/routes/m.capture.tsx` → `/m/capture`
- Single full-screen textarea (large font, autofocus) + "Save" button + tiny "queue: N pending" status when outbox has entries
- On submit: try `api.createNote({ type: "fleeting", title: <first 60 chars>, body_md: <rest> })`. On network error or offline, `enqueueNote(...)` and show toast "saved offline".
- Title fallback: if textarea content has a single line, that's the title and body is empty. If multi-line, first line is title, rest is body.
- Commit: `feat(web): /m/capture mobile capture route`

### Task 5: Mobile inbox route
- `apps/web/src/routes/m.inbox.tsx` → `/m/inbox`
- Two stacked sections: Fleeting notes (use existing inbox API), Highlights (use existing inbox highlights API)
- Simpler card layout than desktop inbox — full-width cards with tap-to-expand
- Actions: archive, promote (opens the desktop editor route in a new tab if needed — mobile doesn't have an editor)
- Commit: `feat(web): /m/inbox mobile inbox route`

### Task 6: Mobile shell + entry
- `apps/web/src/routes/m.tsx` — layout route for `/m` that renders a bottom-tab bar (Capture / Inbox) and an `<Outlet/>`. Suppresses desktop nav from `__root.tsx`.
- Way to know if current route is under `/m`: check `useLocation().pathname.startsWith("/m/")` in `__root.tsx` and conditionally hide the desktop nav.
- Trigger flush loop on app mount via `useEffect` in `__root.tsx`
- Register the service worker via `vite-plugin-pwa`'s auto-register
- Commit: `feat(web): mobile shell route + service worker registration`

### Task 7: E2E + README
- `pnpm -r typecheck` clean
- `pnpm -r --workspace-concurrency=1 test` — all green
- README: add "Mobile" section noting `/m/capture` and offline support
- Commit: `docs: m2 feature-complete (mobile PWA shipped)`

## Conventions
- Same as prior plans
- For `fake-indexeddb`, the import must happen BEFORE the test file's imports of outbox — use a top-of-file `import "fake-indexeddb/auto";`
- Service worker only works on `https` or `localhost` — local dev is fine
