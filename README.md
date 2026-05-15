# Zettelkasten

Personal web-based zettelkasten with auto-graph, topic canvases, and local ML. Single-user, runs on a home Mac behind Tailscale.

See [`docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md`](docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md) for design and [`docs/superpowers/plans/`](docs/superpowers/plans/) for implementation plans.

## Current status

M1 Plan 1 (Foundation) and Plan 2 (Editor + Wikilinks) complete. The stack supports note + link + tag CRUD, a CodeMirror 6 markdown editor with `[[wikilink]]` autocomplete and decoration, a right-rail backlinks panel, and a top bar showing type/tags/last-edited. Wikilinks auto-sync into the `note_link` table on save.

## Setup

Prerequisites: Node 22, pnpm 9+, Docker Desktop.

```bash
pnpm install
pnpm db:up                              # postgres + redis
pnpm --filter @zk/api db:migrate
NODE_ENV=test pnpm --filter @zk/api db:migrate      # also migrate test DB
pnpm dev:api                            # http://localhost:3001
pnpm dev:web                            # http://localhost:5173
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
- `packages/shared` — Zod schemas shared across frontend and backend
- `docker-compose.yml` — Postgres (with pgvector + pg_trgm), Redis
