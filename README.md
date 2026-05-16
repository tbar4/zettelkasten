# Zettelkasten

Personal web-based zettelkasten with auto-graph, topic canvases, and local ML. Single-user, runs on a home Mac behind Tailscale.

See [`docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md`](docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md) for design and [`docs/superpowers/plans/`](docs/superpowers/plans/) for implementation plans.

## Current status

**M1 feature-complete.** The stack supports note + link + tag CRUD, a CodeMirror 6 markdown editor with `[[wikilink]]` autocomplete and decoration, a backlinks panel with note titles, inline tag editing, a ⌘K command palette over Postgres FTS, a Sigma.js graph view at `/graph`, a triage inbox at `/inbox` with spaced-repetition daily review, fleeting-note promotion, and Readwise-highlight promotion, a markdown mirror worker that writes every note to `~/Notes/zettel/` with git auto-commits, a Readwise sync worker that pulls highlights into the inbox, and a one-shot Notion importer at `/import/notion` that converts pages to typed notes with bulk re-typing and mention-to-wikilink rewriting.

## Setup

Prerequisites: Node 22, pnpm 9+, Docker Desktop.

```bash
pnpm install
pnpm db:up                              # postgres + redis
pnpm --filter @zk/api db:migrate
NODE_ENV=test pnpm --filter @zk/api db:migrate      # also migrate test DB
pnpm dev:api                            # http://localhost:3001
pnpm dev:web                            # http://localhost:5173
pnpm dev:mirror                         # writes notes to ~/Notes/zettel and auto-commits
pnpm dev:readwise                       # readwise sync (requires READWISE_TOKEN env var)
```

**Note on Postgres port:** the container exposes `localhost:5433` (not `5432`) to avoid conflicts with `Postgres.app` on macOS.

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
- `packages/shared` — Zod schemas shared across frontend and backend
- `packages/db-schema` — Drizzle schema shared by api, mirror, readwise
- `docker-compose.yml` — Postgres (with pgvector + pg_trgm), Redis
