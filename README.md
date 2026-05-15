# Zettelkasten

Personal web-based zettelkasten with auto-graph, topic canvases, and local ML. Single-user, runs on a home Mac behind Tailscale.

See [`docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md`](docs/superpowers/specs/2026-05-15-zettelkasten-app-design.md) for design.

## Setup

Prerequisites: Node 22, pnpm 9+, Docker Desktop.

```bash
pnpm install
pnpm db:up                # starts postgres + redis
pnpm --filter @zk/api db:migrate
pnpm dev:api              # API on http://localhost:3001
pnpm dev:web              # Web on http://localhost:5173
```

## Tests

```bash
pnpm test                 # all packages
```
