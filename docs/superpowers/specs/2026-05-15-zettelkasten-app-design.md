# Zettelkasten App — Design Spec

**Date:** 2026-05-15
**Status:** Brainstorming complete; awaiting user review of written spec, then plan
**Owner:** Trevor Barnes

## Purpose

A custom, web-based zettelkasten application replacing the user's current Notion-based system. Optimized for:

1. Clarifying and developing the argument of a literal academic dissertation across multiple long-running topics (MOCs).
2. Composing essays, blog posts, and dissertation chapters from accumulated notes.
3. Retaining and recombining knowledge captured from reading (primarily via Readwise).

The user has explicitly chosen to build rather than use Obsidian/Logseq/Heptabase because existing tools don't bend to their workflow tightly enough. The app exists to fit the user's mind, not the other way around.

This is a single-user, single-tenant system. No collaboration, no multi-user, no public sharing.

## Non-goals

- Real-time collaboration / CRDTs
- Browser web-clipper extension
- Voice capture
- Plug-in / extension API
- Publish-as-website feature
- Two-way Notion sync
- Zotero integration (deferred — may add later as additive worker)
- Mobile-first UX (mobile is capture+triage only; desktop is the primary surface)

## High-level architecture

Six bounded concerns, all running on the user's home Mac via Docker Compose, accessed by clients (laptop browser, phone) over Tailscale. No public ingress; no DNS/TLS configuration on the open internet.

1. **Web app** — React 18 + Vite + TypeScript SPA
2. **API** — Node.js + Hono + TypeScript, Drizzle ORM
3. **Database** — Postgres 16 + pgvector extension (primary data store + embeddings)
4. **Markdown mirror** — git-backed plain-text copy at `~/Notes/zettel/`, continuously updated
5. **Ingestion workers** — separate Node processes for Readwise (continuous) and Notion (one-time)
6. **ML service** — Python 3.12 + FastAPI, with Ollama as a sibling container for the local LLM (M3)

Redis is included in Compose as the BullMQ job queue for the workers. Tailscale handles all client access; no app-level network exposure beyond the Tailnet.

The ML service is the only concern that physically depends on running on the Mac (it owns the model weights). All other concerns can lift-and-shift to a VPS later if uptime priorities ever change.

## Data model

Postgres schema, simplified. Drizzle defines the canonical schema in TypeScript.

### Notes & links

- **`note`** — universal note record. Columns: `id`, `type` (enum: `fleeting | literature | permanent | topic`), `title`, `body_md` (null for topic notes), `created_at`, `updated_at`, `archived_at`, `notion_page_id` (nullable, for import idempotency).
- **`note_link`** — directed edges between notes. Columns: `id`, `from_note_id`, `to_note_id`, `link_type` (enum), `context` (free-text annotation), `created_at`.
  - `link_type` starter enum: `references`, `elaborates`, `supports`, `contradicts`, `example_of`, `defines`, `questions`, `derived_from`. Default on new links is `references`.
  - User-extensible via `custom_link_types` table (M2+).
- **`tag`** + **`note_tag`** — flat tag table joined many-to-many. Tags coexist with `type`, they don't replace it.

**Topic notes are organizational only.** API enforces `body_md IS NULL` when `type = 'topic'`. Their "content" is the union of (a) notes pointed at them via `note_link` and (b) the canvas at `canvas.topic_note_id`. Topics can nest (topic-to-topic links via `note_link`) to express dissertation hierarchy.

### Sources & highlights (Readwise pipeline)

- **`source`** — one row per work the user has read. Columns: `id`, `title`, `authors[]`, `source_type` (book/article/podcast/tweet/etc.), `year`, `isbn`, `doi`, `url`, `readwise_book_id`, `bibtex_blob`. All BibTeX-shaped columns are nullable so the user can hand-edit metadata that Readwise doesn't provide.
- **`highlight`** — raw highlights imported from Readwise. Columns: `id`, `source_id`, `text`, `note_text`, `location`, `color`, `readwise_highlight_id`, `promoted_to_note_id` (FK to `note`, nullable), `dismissed_at` (nullable), `created_at`.
- **`citation_reference`** — `(note_id, source_id, locator)` — when a permanent note draws on a source. Powers BibTeX export.

### Canvases (M2)

- **`canvas`** — one canvas per topic note (`canvas.topic_note_id UNIQUE`). Stores Excalidraw scene metadata (viewport, theme).
- **`canvas_item`** — `(canvas_id, note_id, x, y, width, height, color, z_index)`. A given note can appear on multiple canvases at different positions.
- **`canvas_edge`** — visual annotations drawn between canvas items. Separate from `note_link` because canvas edges are spatial sketches, not epistemic claims.

### Manuscripts (M2)

- **`manuscript`** — composition surface. Columns: `id`, `title`, `anchor_topic_ids[]`, `body_md`, `created_at`, `updated_at`.
- **`manuscript_section`** — `(manuscript_id, position, note_id (nullable), is_transclusion, frozen_body_md, heading)`. If `note_id` is set and `is_transclusion = true`, the section live-mirrors that note; if `false`, `frozen_body_md` captures a snapshot.

### ML state (M3)

- **`embedding`** — `(note_id PK, vector vector(768), model_version, generated_at)` via pgvector. One row per note.
- **`suggestion_feedback`** — `(from_note_id, to_note_id, action: 'accepted' | 'rejected' | 'dismissed', surfaced_at)`. Training data for the personal re-ranker.
- **`highlight_promotion_feedback`** — `(highlight_id, action: 'promoted' | 'edited' | 'rejected', draft_text, final_text)`. Training data for the lit-note classifier.
- **`spaced_review`** — `(note_id, last_seen_at, next_due_at, interval_days, status)`. Drives the daily-review queue; M3 ML augments rather than replaces this.

### Sync & job state

- **`sync_job`** — `(name, last_success_at, last_error, status)`. UI surfaces these as banners when sync is unhealthy.

## Storage & sync

**Postgres is canonical.** Every read and write goes through the API.

**Markdown mirror** runs as a background worker. On every note write, the worker debounces 5 minutes and then:

1. Writes/updates `~/Notes/zettel/<slug>.md` with YAML frontmatter (type, tags, links, sources).
2. Stages and commits the change to the git repo at the mirror root with a generated message: `zk: <N> notes updated`.
3. Topic notes (bodyless) get a structured frontmatter-only file with a `linked_notes:` block.

The mirror is push-only from DB to disk. The user can read it but should not edit it directly; the next sync would overwrite their changes. A weekly cron pushes the mirror repo to a private GitHub for off-machine backup.

**Client-server sync** in M1: REST for reads/writes with optimistic UI, plus a websocket channel that broadcasts `note_changed` events so multiple open tabs converge. No CRDT, no desktop offline editing.

**Conflict handling**: debounced saves use `If-Match` on `updated_at`. Concurrent edits return 409 with the current server state and a "your version vs theirs" prompt. Rare in practice on Tailscale.

**Mobile offline capture (M2)**: an IndexedDB outbox queue stores fleeting notes drafted offline; flushes to the API when the device reaches the Tailnet.

**Backups, layered**:
- Nightly `pg_dump` to `~/Backups/zk/`
- Mirror git repo (continuous) + weekly push to private GitHub
- Periodic tarball of ML model weights to `~/Backups/zk/models/` (M3)

## Ingestion pipelines

### Notion import (one-time, M1)

Reads from Notion API or an exported zip. For each page:

1. **Heuristic type detection**:
   - Pages with a `Source` property or quoted-text-dominant body → `literature`
   - Pages with high inbound link count or hierarchical children → `topic`
   - Pages with substantive prose and few links → `permanent`
   - Short, recent, unlinked pages → `fleeting`
2. **Dry-run preview** — emits an `import-preview.json` and renders a review UI in the app:
   - Bulk select + flip type with keystrokes (`F/L/P/T`)
   - Filter by detected confidence
   - Sort by inbound link count
   - Preview pane shows original Notion content alongside the proposed type
3. **Commit** — once reviewed, imports notes, creates `note_link` rows from Notion `@page` mentions, stubs out unresolved links as fleeting notes.
4. **Idempotency** — every imported note carries its `notion_page_id`. Re-running updates rather than duplicating.

Honest expectation: heuristic typing achieves ~60–70% accuracy; the review UI is what makes the remaining 30–40% fast to fix.

### Readwise sync (continuous, M1)

Polls the Readwise API on a 6-hour cron (configurable). For each new highlight:

1. Find-or-create `source` row keyed on `readwise_book_id`.
2. Insert `highlight` row with `promoted_to_note_id = NULL`.

Highlights surface in the **triage inbox** for promotion. Promotion creates a literature note, copies highlight text into the body, sets `promoted_to_note_id`, and records `highlight_promotion_feedback` for the M3 classifier.

### Failure handling

Each worker writes status + last error to `sync_job`. The UI shows a yellow banner when sync is unhealthy ("Readwise hasn't synced in 18h"). Failures never block writes.

## UI surfaces

Six primary routes in the web app, plus a stripped mobile PWA.

### Editor (`/notes/:id`) — M1

CodeMirror 6 + markdown. Custom extensions:
- `[[` autocomplete → fuzzy-searched note picker, inserts wikilink
- Hover wikilink → peek of target note
- Right rail: backlinks, outbound links grouped by `link_type`, related-notes panel (empty in M1, ML-driven in M3)
- Top bar: type indicator, tags, last-edited, "open canvas" button (when on any)
- Literature notes: pinned "Source" block at top with Readwise document + originating highlights
- Slash menu for callouts, code blocks, image embeds, citations

CodeMirror 6 chosen over TipTap/Lexical because markdown is the source of truth and the user sees exactly what's saved.

### Graph view (`/graph`) — M1

Sigma.js. Auto-generated from `note_link`. Controls:
- Color by note `type` or by `link_type`
- Filter by tag, type, date range, or "linked to topic X"
- Click node → side-panel preview without leaving graph
- Local-neighborhood mode (N hops from a focal note)

### Topic canvases (`/topics/:id/canvas`) — M2

Excalidraw embedded (matches user's existing Sketch Your Mind learning). Custom Excalidraw elements link to notes:
- Drag note cards (compact previews) onto the canvas
- Draw freeform connections (canvas-only, not knowledge claims)
- One canvas per topic note

### Triage inbox (`/inbox`) — M1 + M3

Four panes:
1. **Today's review** — surfaced notes for re-encounter. M1 implementation: simple spaced-repetition (1d → 3d → 7d → 14d → 30d → 90d intervals). M3 replaces the ranker: combines embedding distance to recently-edited notes + personal re-ranker preferences + base time-decay. UI is the same in both versions.
2. **Fleeting notes** to process (promote, archive, delete).
3. **Un-promoted Readwise highlights** grouped by source. M3 adds a promote-worthy confidence chip from the lit-note classifier.
4. (Future) **Stale topic notes** that haven't been touched.

This is the daily-habit surface. Leaving Notion's slow loading hinges on this being fast.

### Search (`/search` + global ⌘K) — M1 (text) + M3 (semantic)

- M1: Postgres FTS for exact-word queries with filters
- M3: pgvector semantic mode toggle for conceptual queries
- Filters: type, tag, source, date range, has-canvas
- ⌘K overlays globally; Enter navigates, Cmd-Enter opens in side panel

### Manuscript view (`/manuscripts/:id`) — M2

Three-pane composition surface for assembling notes into long-form drafts:
- **Left rail**: notes linked from anchor topics, grouped by `link_type`, searchable
- **Center**: linear outline editor (markdown + headings)
- **Right rail**: references collector, populated automatically as notes are dropped in

Dragging a note in offers **transclude** (live-linked) or **copy** (frozen snapshot). Both have legitimate use.

**Exports**:
- Markdown with `[@source-key]` citation syntax
- Pandoc-flavored Markdown → LaTeX (thesis chapters)
- DOCX (advisor comments)

### Ask (`/ask`) — M3

RAG Q&A over the zettelkasten.
- Question → embed → top-12 from `embedding` → personal re-ranker → top-5 to LLM with citation-enforcement system prompt
- Answers always cite via clickable `[[note-id]]` refs; LLM declines to answer when it can't ground claims in notes
- **"Draft this as a permanent note"** button: feeds the conversation + cited notes back to the LLM with a "write a single atomic claim in Trevor's voice" prompt; the draft surfaces in an editor pane for review before saving

### Mobile PWA — M2

Two routes only:
- **Capture** — single textarea creating a fleeting note; offline-capable via IndexedDB outbox
- **Inbox** — triage inbox stripped to fleeting + highlights

No editor, no graph, no canvas, no manuscript. Capture-first, review-on-desktop.

## ML service (M3)

Python FastAPI service on the Mac. Four capabilities; all local, no APIs.

### Embeddings (frozen)

- Model: `nomic-embed-text-v1.5` (768-dim) on Apple Silicon Metal. Fallback to `bge-small-en-v1.5` (384-dim) on lower-memory machines.
- Triggered on every note write. Backfill on first install.
- Stored in `embedding` table via pgvector.
- Base model never trained — kept as a stable coordinate system.

### Personal re-ranker (online learning)

- Model: 2-layer MLP on top of cosine similarity + hand-features (`shared_tags`, `same_type`, `same_topic`, `link_density`, `temporal_proximity`).
- Training signal: every `suggestion_feedback` row (user accepts or rejects a suggested related-note link).
- Update strategy: mini-batch SGD every 50 new feedback events, or nightly if fewer. Model file < 1 MB.
- Cold-start: bypassed until 30 feedback events accumulated; UI tells user "ML is learning."
- Reorders raw embedding candidates by *the user's* notion of relatedness.

### Local LLM (frozen + optional LoRA)

- Default: Qwen 2.5 7B Instruct via Ollama. Switchable to Llama 3.1 8B or Phi-3.5 Mini.
- RAG pipeline: question → embed → retrieve top-12 → re-rank to top-5 → LLM with strict citation prompt.
- **Optional LoRA fine-tune** on user's permanent notes — opt-in weekend job. Prompts when >200 new permanent notes since last train. Adapter only; base weights untouched. PEFT library handles training and serving.

### Literature-note classifier (online learning)

- Task: predict promote-worthiness for each new Readwise highlight.
- Model: XGBoost on features (highlight length, color, embedding distance to existing permanent notes, source type, time of day, per-source promotion rate, etc.).
- Training signal: every `highlight_promotion_feedback` row.
- Output: probability score, surfaced in highlights inbox as a confidence chip, used for sort order.

### Compute footprint (M1 Pro or newer, 16 GB+ unified RAM)

- Embedding inference: ~50 ms per note via Metal
- Re-ranker inference: < 1 ms
- Qwen 2.5 7B: ~30 tok/s, first token ~1 s
- Classifier inference: < 1 ms
- Re-ranker training: seconds to minutes, runs on idle
- LoRA fine-tune: hours, runs overnight on user opt-in

## Hosting & access

- Docker Compose on the Mac runs every service except potentially Ollama (which has its own native macOS install for better Metal performance).
- Tailscale tunnel for laptop and phone access. No public ports.
- Single-user authentication: HTTP Basic over Tailscale is sufficient at this scale. (Can upgrade to a real auth layer if needed without other changes.)
- Migration path: every concern except the ML service runs in Docker, so lifting app + DB + workers to a Hetzner/DigitalOcean VPS is a `docker compose down && docker compose up` on the new host, plus pointing DNS at Tailscale Funnel or a direct IP. ML service stays on the Mac and the new VPS API calls it over Tailscale.

## Milestones

### M1 — Foundation (3–4 weeks)

*Goal: leave Notion, have a daily-usable zettelkasten.*

- Docker Compose stack: Postgres+pgvector, Redis, Hono API, React web app, mirror worker, Readwise worker, Tailscale-fronted
- Note CRUD with 4-tier types (topic notes enforced bodyless)
- `note_link` with 8 typed relations + free-text `context`; `[[wikilink]]` autocomplete; backlinks panel
- Tags
- Auto-graph view (Sigma.js)
- Full-text search (Postgres FTS) + ⌘K command palette
- Triage inbox: fleeting pane + highlights pane + simple time-decay "today's review"
- Markdown mirror + 5-min debounced git auto-commit
- Nightly `pg_dump` backups
- Readwise continuous sync
- Notion one-time import with dry-run + bulk re-type review UI
- HTTP Basic single-user auth

### M2 — Visual thinking + manuscripts (3–4 weeks)

*Goal: turn notes into structured arguments.*

- Topic canvases via Excalidraw embedded, with custom elements linking to notes
- Manuscript view: left-rail note picker, center outline, right-rail references, transclude-vs-copy
- Manuscript exports: Markdown, Pandoc → LaTeX, DOCX
- Mobile PWA: capture + inbox only
- IndexedDB offline outbox for mobile capture
- Custom user-defined link types (`custom_link_types` table + UI)

### M3 — Local ML (3–4 weeks)

*Goal: real differentiation — your zettelkasten learns from your behavior.*

- FastAPI ML service in Compose; Ollama sibling for the LLM
- Embedding worker (re-embed on note change, backfill once)
- Semantic search mode in `/search` and ⌘K
- Related-notes panel in editor right-rail
- `suggestion_feedback` collection from accept/reject actions
- Personal re-ranker training, inference, online updates
- `/ask` RAG surface with citation enforcement
- "Draft this as a permanent note" on Q&A answers
- Lit-note promote-worthiness classifier in highlights inbox
- ML-driven daily review prompt (replaces M1 time-decay implementation)
- LoRA fine-tune opt-in toggle
- BibTeX export from `source` table

## Tech stack

- **Frontend**: React 18, Vite, TypeScript, TanStack Router, TanStack Query, Zustand, CodeMirror 6, Sigma.js, Excalidraw, react-markdown + remark
- **API**: Node.js, Hono, TypeScript, Drizzle ORM, Zod (shared schema package)
- **Database**: Postgres 16, pgvector, Postgres FTS
- **Workers**: Node.js, BullMQ, Redis
- **ML service**: Python 3.12, FastAPI, sentence-transformers, PyTorch, XGBoost, peft
- **LLM runtime**: Ollama (native macOS install for Metal performance)
- **Orchestration**: Docker Compose
- **Network**: Tailscale

## Open risks

- **Notion importer heuristic accuracy** — the dry-run review UI must be genuinely fast to make this workable. Worth a usability test on the user's actual data before considering M1 done.
- **Mobile capture UX** — IndexedDB outbox is straightforward but the user habit needs to actually form. M2 should include a brief observation period before declaring success.
- **LLM RAG quality on a 7B model** — local LLMs are genuinely useful but limited. The "citation enforcement" pattern is critical to avoid hallucinated note refs. May need iteration.
- **Online re-ranker cold-start** — 30 events is a guess. May need to be adjusted up or down once we see real data.
- **Single-Mac availability** — if the Mac is off, the system is unreachable. Acceptable for now; migration path is documented above.
