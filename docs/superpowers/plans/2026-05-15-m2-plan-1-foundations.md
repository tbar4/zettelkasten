# M2 Plan 1: Custom link types + M2 schema foundations

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** Land all M2 database tables in one migration, plus the user-facing custom link types feature.

**Architecture:** Single migration `0005_m2_foundations.sql` adds `custom_link_type`, `canvas`, `canvas_item`, `canvas_edge`, `manuscript`, `manuscript_section`. UI only ships for custom link types this plan; canvas/manuscript tables are scaffolding for Plans 2–4.

**Tech stack:** Drizzle ORM, Hono, React, Zod (existing).

---

## Schema additions

In `packages/db-schema/src/schema.ts`, add after the existing tables:

```ts
export const customLinkTypes = pgTable(
  "custom_link_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => [
    check("custom_link_type_name_not_empty", sql`length(${t.name}) > 0`)
  ]
);
```

Add `customLinkTypeId` nullable column to `noteLinks`. When `customLinkTypeId IS NOT NULL`, the `linkType` enum is overridden by the custom type. Add an index on `customLinkTypeId`.

Canvas tables:
```ts
export const canvases = pgTable(
  "canvas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicNoteId: uuid("topic_note_id")
      .notNull()
      .unique()
      .references(() => notes.id, { onDelete: "cascade" }),
    sceneData: text("scene_data"),   // Excalidraw scene JSON
    viewport: text("viewport"),       // {x, y, zoom} JSON
    theme: text("theme"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  }
);

export const canvasItems = pgTable(
  "canvas_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    width: integer("width").notNull().default(200),
    height: integer("height").notNull().default(120),
    color: text("color"),
    zIndex: integer("z_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => [
    index("canvas_item_canvas_idx").on(t.canvasId),
    index("canvas_item_note_idx").on(t.noteId)
  ]
);

export const canvasEdges = pgTable(
  "canvas_edge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    fromItemId: uuid("from_item_id")
      .notNull()
      .references(() => canvasItems.id, { onDelete: "cascade" }),
    toItemId: uuid("to_item_id")
      .notNull()
      .references(() => canvasItems.id, { onDelete: "cascade" }),
    label: text("label"),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => [
    index("canvas_edge_canvas_idx").on(t.canvasId),
    check("canvas_edge_not_self", sql`${t.fromItemId} <> ${t.toItemId}`)
  ]
);
```

Manuscript tables:
```ts
export const manuscripts = pgTable(
  "manuscript",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    anchorTopicIds: uuid("anchor_topic_ids").array().notNull().default(sql`'{}'::uuid[]`),
    bodyMd: text("body_md"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  }
);

export const manuscriptSections = pgTable(
  "manuscript_section",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    manuscriptId: uuid("manuscript_id")
      .notNull()
      .references(() => manuscripts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    isTransclusion: boolean("is_transclusion").notNull().default(true),
    frozenBodyMd: text("frozen_body_md"),
    heading: text("heading"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => [
    index("manuscript_section_manuscript_idx").on(t.manuscriptId),
    index("manuscript_section_position_idx").on(t.manuscriptId, t.position)
  ]
);
```

You'll need to import `boolean` from drizzle pg-core.

## Migration

Generate via `pnpm --filter @zk/api db:generate` (or hand-write if the script is missing — there's no generate script currently, see `apps/api/package.json`). If hand-writing, name it `0005_m2_foundations.sql`, and update `meta/_journal.json` and add `meta/0005_snapshot.json` (or skip the snapshot and rely on raw SQL — Drizzle migrator only reads `_journal.json` for sequencing). Use `IF NOT EXISTS` on all CREATEs for safety.

The migration must also `ALTER TABLE note_link ADD COLUMN custom_link_type_id uuid REFERENCES custom_link_type(id) ON DELETE SET NULL;` and create the index.

## Tasks

### Task 1: Schema + migration
- Add all 6 tables + `note_link.custom_link_type_id` to `packages/db-schema/src/schema.ts`
- Hand-write `apps/api/src/db/migrations/0005_m2_foundations.sql`
- Update `meta/_journal.json`
- Run `pnpm --filter @zk/api db:migrate` and `NODE_ENV=test pnpm --filter @zk/api db:migrate`
- Run `pnpm --filter @zk/db-schema typecheck`
- Commit: `feat(db): m2 foundations schema (custom link types + canvas + manuscript)`

### Task 2: Custom link types API
- New file `apps/api/src/routes/custom-link-types.ts`
- Routes: `GET /api/custom-link-types`, `POST`, `PATCH /:id`, `DELETE /:id`
- Use `@hono/zod-validator` + `zodErrorHook` pattern from existing routes
- Mount at `/api/custom-link-types` in `apps/api/src/server.ts`
- Tests: `apps/api/tests/custom-link-types.test.ts` covering all 4 verbs + name-uniqueness + length-check
- Commit: `feat(api): /api/custom-link-types crud routes`

### Task 3: Wire into note links
- Modify `POST /api/notes/:id/links` and the link list response to accept/return `customLinkTypeId`
- The existing `linkType` enum stays as a fallback default; when `customLinkTypeId` is set, surface it instead
- Update the `LinksPanel`-feeding endpoint (`GET /api/notes/:id/links` or equivalent) to LEFT JOIN custom_link_type and return `customLinkTypeName`
- Tests in `apps/api/tests/note-links.test.ts` (or wherever links live)
- Commit: `feat(api): note links accept and surface custom link types`

### Task 4: Web UI for custom link types
- New route `apps/web/src/routes/settings.link-types.tsx` (TanStack Router) → `/settings/link-types`
- Simple list + create form + inline rename + delete confirmation
- Use TanStack Query for fetch + mutate
- Add link to it from `__root.tsx` nav
- Component test in `apps/web/tests/`
- Commit: `feat(web): /settings/link-types route for managing custom link types`

### Task 5: Wire custom types into LinksPanel
- In the existing `LinksPanel.tsx` (or whatever component renders the link picker for adding/editing a link), fetch custom link types alongside built-ins
- The link-type select shows: built-in enum options + an `---` divider + custom types
- When user picks a custom type, send `customLinkTypeId` in the POST
- Update displayed link badges to show custom name when present
- Commit: `feat(web): custom link types appear in note link picker`

### Task 6: E2E + commit message
- `pnpm -r typecheck` clean
- `pnpm -r --workspace-concurrency=1 test` — all green
- Commit any cleanup as `docs: M2 Plan 1 readme update` if needed

## Conventions
- `db: any` parameter pattern for functions accepting tx OR top-level db
- Drizzle 0.36 array-form extras: `(t) => [...]`
- TRUNCATE-CASCADE test isolation — add new tables to existing `_setup.ts` TRUNCATE list
- noUncheckedIndexedAccess strict; use `!.` when access is provably safe
- Hono routes use shared `zodErrorHook` for `{error: string}` shape
- TanStack Router: file-based, dot is separator (`settings.link-types.tsx` → `/settings/link-types`)
- No comments unless WHY is non-obvious
