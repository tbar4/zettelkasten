# Readwise Ingestion Implementation Plan (M1, Plan 5 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull highlights from Readwise into the database as raw `highlight` rows attached to a `source`. Surface un-promoted highlights in the `/inbox` highlights pane. Promote a highlight into a literature note via one click. Show the source block at the top of a literature note's detail page. Front-load four Plan 4 carry-overs.

**Architecture:** Two new tables: `source` (one row per book/article/document Readwise tracks) and `highlight` (raw highlights with `promoted_to_note_id` lineage). A new `apps/readwise` worker polls the Readwise API on a configurable interval, upserts sources by `readwise_book_id`, and inserts highlights by `readwise_highlight_id`. Promoting a highlight creates a `literature` note copying the highlight text into the body, links it to the source, and sets `promoted_to_note_id` on the original highlight. The schema migration moves to `packages/db-schema` so `apps/mirror` and `apps/readwise` no longer cross-import from `apps/api`.

**Tech Stack:** `node:fetch` for the Readwise API client (no SDK; the v2 export endpoint returns JSON). Same Drizzle + Postgres patterns as prior plans.

---

## File Structure

```
packages/db-schema/                          (new package)
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                             (re-exports everything)
    └── schema.ts                            (moved from apps/api/src/db/schema.ts)

apps/api/src/db/
├── schema.ts                                (deleted)
└── client.ts                                (modify: import from @zk/db-schema)

apps/api/src/
├── db/migrations/0004_source_highlight.sql  (generated)
├── routes/
│   ├── sources.ts                           (create) — GET /api/sources/:id
│   ├── highlights.ts                        (create) — POST /api/highlights/:id/promote
│   └── inbox.ts                             (modify) — include un-promoted highlights
└── lib/
    └── promote-highlight.ts                 (create) — shared promote logic

apps/mirror/src/
├── schema-mirror.ts                         (deleted — replaced by direct @zk/db-schema import)
├── sweep.ts                                 (modify: import from @zk/db-schema; skip-write when unchanged)
└── frontmatter.ts                           (modify: escape control chars in quoted strings)

apps/web/src/
├── components/
│   ├── InboxHighlightsPane.tsx              (modify: real impl with promote action)
│   ├── InboxFleetingPane.tsx                (modify: per-row mutation isolation)
│   └── LiteratureSourceBlock.tsx            (create) — fixed source block
├── routes/notes.$noteId.tsx                 (modify) — render LiteratureSourceBlock for literature notes
└── lib/api-client.ts                        (modify) — promoteHighlight method

apps/readwise/                               (new package, mirrors apps/mirror shape)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                             — entrypoint
│   ├── env.ts                               — config + READWISE_TOKEN
│   ├── client.ts                            — fetch wrapper for Readwise v2 API
│   └── sync.ts                              — upsert source + insert highlights
└── tests/
    ├── client.test.ts                       — mocked fetch
    └── sync.test.ts                         — DB-backed
```

**Why this layout**

- `packages/db-schema` ends the cross-package source import (`apps/mirror/src/schema-mirror.ts` was a workaround). Both `apps/api` and `apps/mirror` and the new `apps/readwise` import schema from the same workspace package — symmetric, no relative paths into another app's `src`.
- `lib/promote-highlight.ts` is shared between the highlights route (`POST /api/highlights/:id/promote`) and any future bulk-promote flow.
- `apps/readwise` mirrors `apps/mirror`'s shape: a long-lived Node process with a `setInterval` loop and a sync function the tests can drive directly.

---

## Conventions

- **Postgres on `localhost:5433`**.
- **Workspace test serialization** (`--workspace-concurrency=1`) already in place from Plan 4.
- **`READWISE_TOKEN` env var** is required for the worker to actually sync; sync tests use mocked fetch so they don't need a real token.
- **TDD** — failing test, then implementation. Each task commits.

---

## Task 1: Extract `packages/db-schema`

The mirror's cross-package import (`apps/mirror/src/schema-mirror.ts` → `apps/api/src/db/schema.ts`) is fragile. Move the schema to its own workspace package and update both apps.

**Files:**
- Create: `packages/db-schema/package.json`
- Create: `packages/db-schema/tsconfig.json`
- Create: `packages/db-schema/src/schema.ts` (moved from `apps/api/src/db/schema.ts`)
- Create: `packages/db-schema/src/index.ts`
- Delete: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/client.ts` — import from `@zk/db-schema`
- Modify: `apps/api/src/db/migrate.ts` — no change needed
- Modify: `apps/api/src/routes/*.ts` — update schema imports
- Modify: `apps/api/src/lib/*.ts` — update schema imports
- Modify: `apps/api/drizzle.config.ts` — point to new schema location
- Modify: `apps/api/tests/*.ts` — update imports
- Modify: `apps/api/package.json` — add `@zk/db-schema: workspace:*`
- Delete: `apps/mirror/src/schema-mirror.ts`
- Modify: `apps/mirror/src/sweep.ts` — import from `@zk/db-schema`
- Modify: `apps/mirror/tests/sweep.test.ts` — import from `@zk/db-schema`
- Modify: `apps/mirror/package.json` — add `@zk/db-schema`
- Modify: `apps/mirror/tsconfig.json` — drop the explicit `../api/src/db/schema.ts` include

- [ ] **Step 1: Create `packages/db-schema/package.json`**

```json
{
  "name": "@zk/db-schema",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.4"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Create `packages/db-schema/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "lib": ["ES2022"],
    "composite": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Move `apps/api/src/db/schema.ts` → `packages/db-schema/src/schema.ts`**

```bash
mkdir -p packages/db-schema/src
git mv apps/api/src/db/schema.ts packages/db-schema/src/schema.ts
```

- [ ] **Step 4: Create `packages/db-schema/src/index.ts`**

```ts
export * from "./schema";
```

- [ ] **Step 5: Update `apps/api/package.json`** — add the new dep

Read the file. Inside `dependencies`, add `@zk/db-schema`:

```json
"@zk/db-schema": "workspace:*",
```

(Insert in alphabetical order — between `@hono/zod-validator` and `@zk/shared`.)

- [ ] **Step 6: Update every API import of `"../db/schema"` (and similar)** to `"@zk/db-schema"`

Run from the repo root:

```bash
grep -rl "from \"\.\.\/db\/schema\"" apps/api/src apps/api/tests
grep -rl "from \"\.\.\/\.\.\/db\/schema\"" apps/api/src apps/api/tests
```

For each file the greps return, replace the relative path with `@zk/db-schema`. Typical patterns to fix:

In `apps/api/src/routes/*.ts`: `from "../db/schema"` → `from "@zk/db-schema"`
In `apps/api/src/db/client.ts`: `from "./schema"` → `from "@zk/db-schema"`
In `apps/api/src/lib/*.ts`: `from "../db/schema"` → `from "@zk/db-schema"`
In `apps/api/tests/*.ts`: `from "../src/db/schema"` → `from "@zk/db-schema"`

The simplest mechanical approach: open each file with a relative `db/schema` import and rewrite the import line.

- [ ] **Step 7: Update `apps/api/drizzle.config.ts`** — point to the new schema location

Read the file. Replace `schema: "./src/db/schema.ts"` with:

```ts
schema: "../../packages/db-schema/src/schema.ts",
```

- [ ] **Step 8: Update `apps/mirror`**

In `apps/mirror/package.json`, add `@zk/db-schema` to `dependencies` (alphabetical):

```json
"@zk/db-schema": "workspace:*",
```

Delete `apps/mirror/src/schema-mirror.ts`:

```bash
git rm apps/mirror/src/schema-mirror.ts
```

In `apps/mirror/src/sweep.ts`, find:

```ts
import { notes, noteLinks, noteTags, tags } from "./schema-mirror";
```

Replace with:

```ts
import { notes, noteLinks, noteTags, tags } from "@zk/db-schema";
```

In `apps/mirror/tests/sweep.test.ts`, find:

```ts
import * as schema from "../../api/src/db/schema";
```

Replace with:

```ts
import * as schema from "@zk/db-schema";
```

In `apps/mirror/tsconfig.json`, remove the explicit `../api/src/db/schema.ts` from `include`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*", "vitest.config.ts"],
  "references": [
    { "path": "../../packages/shared" },
    { "path": "../../packages/db-schema" }
  ]
}
```

- [ ] **Step 9: Install**

Run: `pnpm install`
Expected: success — `@zk/db-schema` linked.

- [ ] **Step 10: Typecheck and test**

Run: `pnpm -r typecheck`
Expected: clean.

Run: `pnpm test`
Expected: 121 tests still pass.

- [ ] **Step 11: Commit**

```bash
git add packages/db-schema apps/api apps/mirror package.json pnpm-lock.yaml
git commit -m "refactor: extract db schema into packages/db-schema"
```

---

## Task 2: Mirror polish — YAML escape control chars + skip-write when unchanged

Two small Plan 4 carry-overs combined.

**Files:**
- Modify: `apps/mirror/src/frontmatter.ts`
- Modify: `apps/mirror/src/sweep.ts`
- Modify: `apps/mirror/tests/frontmatter.test.ts`
- Modify: `apps/mirror/tests/sweep.test.ts`

- [ ] **Step 1: Append a failing test to `apps/mirror/tests/frontmatter.test.ts`**

Inside the existing `describe("frontmatter.serialize", ...)`:

```ts
  it("escapes control characters in quoted strings", () => {
    const out = serialize({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "permanent",
      title: "Line\nBreak\tTab\rCR",
      bodyMd: "x",
      tags: [],
      links: [],
      createdAt: new Date("2026-05-15T10:00:00.000Z"),
      updatedAt: new Date("2026-05-15T10:00:00.000Z")
    });
    expect(out).toContain('title: "Line\\nBreak\\tTab\\rCR"');
    expect(out).not.toMatch(/title: "[^"]*\n/); // raw newline shouldn't appear inside title
  });
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm --filter @zk/mirror test frontmatter`
Expected: FAIL — current escaper doesn't handle \n/\r/\t.

- [ ] **Step 3: Update `apps/mirror/src/frontmatter.ts`** — extend the escaper

Find `quoteString`:

```ts
function quoteString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
```

Replace with:

```ts
function quoteString(s: string): string {
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}
```

- [ ] **Step 4: Add a sweep skip-write test to `apps/mirror/tests/sweep.test.ts`**

Inside `describe("runSweep", ...)`:

```ts
  it("does not rewrite a file when content is unchanged", async () => {
    await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Stable", bodyMd: "x" })
      .returning();
    await runSweep(url, mirrorDir);
    const files = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
    const mtimeBefore = (
      await import("fs/promises").then((m) => m.stat(join(mirrorDir, files[0]!)))
    ).mtimeMs;

    // Sleep so any rewrite would change mtime detectably.
    await new Promise((r) => setTimeout(r, 50));

    await runSweep(url, mirrorDir);
    const mtimeAfter = (
      await import("fs/promises").then((m) => m.stat(join(mirrorDir, files[0]!)))
    ).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });
```

- [ ] **Step 5: Run the sweep test to verify it fails**

Run: `pnpm --filter @zk/mirror test sweep`
Expected: FAIL — sweep currently rewrites every file every tick.

- [ ] **Step 6: Update `apps/mirror/src/sweep.ts`** — skip writes when content matches

Find the file-write loop:

```ts
for (const [name, content] of desired) {
  await writeFile(join(mirrorDir, name), content, "utf8");
  written++;
}
```

Replace with:

```ts
for (const [name, content] of desired) {
  const path = join(mirrorDir, name);
  let existing: string | null = null;
  try {
    existing = await (await import("fs/promises")).readFile(path, "utf8");
  } catch {
    existing = null;
  }
  if (existing === content) continue;
  await writeFile(path, content, "utf8");
  written++;
}
```

This reads the existing file first (or treats missing as `null`) and only writes if bytes differ. `written` no longer counts no-op passes.

- [ ] **Step 7: Run all mirror tests**

Run: `pnpm --filter @zk/mirror test`
Expected: PASS — frontmatter (4) + sweep (4) + slug (6) = 14 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/mirror
git commit -m "fix(mirror): escape \\n \\r \\t in quoted YAML; skip writeFile when content unchanged"
```

---

## Task 3: InboxFleetingPane per-row mutation isolation

A click on any row's button currently disables all rows' buttons. Scope the disabled state per row using the mutation variables.

**Files:**
- Modify: `apps/web/src/components/InboxFleetingPane.tsx`

- [ ] **Step 1: Read the current file**

Identify the two `useMutation` calls (`promoteMutation`, `archiveMutation`) and the buttons that use `*.isPending`.

- [ ] **Step 2: Replace the file content**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api-client";

interface FleetingItem {
  id: string;
  title: string;
  type: string;
}

interface InboxFleetingPaneProps {
  items: FleetingItem[];
}

export function InboxFleetingPane({ items }: InboxFleetingPaneProps) {
  const qc = useQueryClient();

  const promoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const note = await api.getNote(noteId);
      return api.promoteToPermanent(noteId, note.updated_at);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.archiveNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  const pendingId = promoteMutation.variables ?? archiveMutation.variables;

  return (
    <div className="inbox-pane">
      <h3>Fleeting ({items.length})</h3>
      {items.length === 0 ? (
        <p className="inbox-empty">No fleeting notes to process.</p>
      ) : (
        items.map((n) => {
          const rowPending = pendingId === n.id;
          return (
            <div key={n.id} className="inbox-row">
              <Link
                to="/notes/$noteId"
                params={{ noteId: n.id }}
                className="inbox-row-title"
              >
                {n.title}
              </Link>
              <div className="inbox-row-actions">
                <button
                  onClick={() => promoteMutation.mutate(n.id)}
                  disabled={rowPending}
                >
                  Promote
                </button>
                <button
                  onClick={() => {
                    if (confirm("Archive this fleeting note?")) {
                      archiveMutation.mutate(n.id);
                    }
                  }}
                  disabled={rowPending}
                >
                  Archive
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
```

The `pendingId` derivation uses `mutation.variables` (the last value passed to `mutate`) — when any mutation is in flight, the `variables` field holds the note id; when idle, it's `undefined`. Only the row matching that id gets disabled.

- [ ] **Step 3: Typecheck and test**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

Run: `pnpm --filter @zk/web test`
Expected: 9 web tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/InboxFleetingPane.tsx
git commit -m "fix(web): scope InboxFleetingPane button disabled state per row"
```

---

## Task 4: Source + Highlight schema migration

**Files:**
- Modify: `packages/db-schema/src/schema.ts`
- Generated: `apps/api/src/db/migrations/0004_source_highlight.sql`

- [ ] **Step 1: Update `packages/db-schema/src/schema.ts`** — append source and highlight tables

Read the file. Append after the existing tables:

```ts
export const sources = pgTable(
  "source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    author: text("author"),
    sourceType: text("source_type"),
    url: text("url"),
    isbn: text("isbn"),
    readwiseBookId: text("readwise_book_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => [
    uniqueIndex("source_readwise_id_idx")
      .on(t.readwiseBookId)
      .where(sql`${t.readwiseBookId} IS NOT NULL`)
  ]
);

export const highlights = pgTable(
  "highlight",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    noteText: text("note_text"),
    location: text("location"),
    color: text("color"),
    readwiseHighlightId: text("readwise_highlight_id"),
    promotedToNoteId: uuid("promoted_to_note_id").references(() => notes.id, {
      onDelete: "set null"
    }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (t) => [
    uniqueIndex("highlight_readwise_id_idx")
      .on(t.readwiseHighlightId)
      .where(sql`${t.readwiseHighlightId} IS NOT NULL`),
    index("highlight_source_idx").on(t.sourceId),
    index("highlight_unprocessed_idx")
      .on(t.sourceId)
      .where(sql`${t.promotedToNoteId} IS NULL AND ${t.dismissedAt} IS NULL`)
  ]
);

export const noteSources = pgTable(
  "note_source",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" })
  },
  (t) => [primaryKey({ columns: [t.noteId, t.sourceId] })]
);
```

- [ ] **Step 2: Generate migration**

Run: `pnpm --filter @zk/api exec drizzle-kit generate --name=source_highlight`
Expected: `apps/api/src/db/migrations/0004_source_highlight.sql` appears with `CREATE TABLE source`, `CREATE TABLE highlight`, `CREATE TABLE note_source`, plus indexes.

- [ ] **Step 3: Apply migration to both DBs**

```bash
pnpm --filter @zk/api db:migrate
NODE_ENV=test pnpm --filter @zk/api db:migrate
```

Both print `Migrations complete.`

- [ ] **Step 4: Update `apps/api/tests/setup.ts`** — truncate the new tables

Find the `beforeEach` TRUNCATE block. Update to include the new tables:

```ts
beforeEach(async () => {
  await db.execute(
    rawSql`TRUNCATE TABLE note_source, highlight, source, spaced_review, note_tag, note_link, tag, note RESTART IDENTITY CASCADE`
  );
});
```

- [ ] **Step 5: Update `apps/mirror/tests/sweep.test.ts`** — same TRUNCATE update

Find its `beforeEach` and update analogously.

- [ ] **Step 6: Run all tests**

Run: `pnpm test`
Expected: 121 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/db-schema apps/api/src/db/migrations apps/api/tests/setup.ts apps/mirror/tests/sweep.test.ts
git commit -m "feat(db): source, highlight, note_source tables"
```

---

## Task 5: API — promote highlight to literature note

`POST /api/highlights/:id/promote` creates a literature note from a highlight's text, links the note to the highlight's source via `note_source`, sets `promoted_to_note_id` on the highlight, and returns the new note.

**Files:**
- Create: `apps/api/src/lib/promote-highlight.ts`
- Create: `apps/api/src/routes/highlights.ts`
- Modify: `apps/api/src/server.ts` — mount the route
- Create: `apps/api/tests/highlights.test.ts`

- [ ] **Step 1: Write failing test `apps/api/tests/highlights.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { app } from "../src/server";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function createHighlight(opts: {
  sourceTitle: string;
  text: string;
}): Promise<{ sourceId: string; highlightId: string }> {
  const [source] = await db
    .insert(schema.sources)
    .values({ title: opts.sourceTitle })
    .returning();
  const [highlight] = await db
    .insert(schema.highlights)
    .values({ sourceId: source!.id, text: opts.text })
    .returning();
  return { sourceId: source!.id, highlightId: highlight!.id };
}

describe("POST /api/highlights/:id/promote", () => {
  it("creates a literature note and links it to the source", async () => {
    const { sourceId, highlightId } = await createHighlight({
      sourceTitle: "Discipline & Punish",
      text: "Power is exercised through visibility."
    });

    const res = await app.request(`/api/highlights/${highlightId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(201);
    const note = (await res.json()) as {
      id: string;
      type: string;
      body_md: string;
    };
    expect(note.type).toBe("literature");
    expect(note.body_md).toContain("Power is exercised through visibility.");

    // Highlight's promoted_to_note_id is set.
    const [h] = await db
      .select()
      .from(schema.highlights)
      .where(eq(schema.highlights.id, highlightId));
    expect(h!.promotedToNoteId).toBe(note.id);

    // note_source row exists.
    const ns = await db
      .select()
      .from(schema.noteSources)
      .where(eq(schema.noteSources.noteId, note.id));
    expect(ns).toHaveLength(1);
    expect(ns[0]!.sourceId).toBe(sourceId);
  });

  it("returns 404 for an unknown highlight id", async () => {
    const res = await app.request(
      "/api/highlights/550e8400-e29b-41d4-a716-446655440099/promote",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 if highlight already promoted", async () => {
    const { highlightId } = await createHighlight({
      sourceTitle: "S",
      text: "T"
    });
    await app.request(`/api/highlights/${highlightId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const res = await app.request(`/api/highlights/${highlightId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(409);
  });

  it("optionally overrides title", async () => {
    const { highlightId } = await createHighlight({
      sourceTitle: "Author",
      text: "Quote text"
    });
    const res = await app.request(`/api/highlights/${highlightId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Custom Title" })
    });
    const note = (await res.json()) as { title: string };
    expect(note.title).toBe("Custom Title");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test highlights`
Expected: FAIL — endpoint doesn't exist.

- [ ] **Step 3: Create `apps/api/src/lib/promote-highlight.ts`**

```ts
import { eq } from "drizzle-orm";
import { highlights, notes, noteSources, sources } from "@zk/db-schema";

export interface PromoteInput {
  highlightId: string;
  titleOverride?: string;
}

export interface PromoteResult {
  noteId: string;
}

export type PromoteError =
  | { kind: "not_found" }
  | { kind: "already_promoted"; noteId: string };

export async function promoteHighlight(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: PromoteInput
): Promise<{ ok: true; result: PromoteResult } | { ok: false; error: PromoteError }> {
  return await db.transaction(async (tx: typeof db) => {
    const [highlight] = await tx
      .select()
      .from(highlights)
      .where(eq(highlights.id, input.highlightId));
    if (!highlight) return { ok: false, error: { kind: "not_found" } as const };
    if (highlight.promotedToNoteId) {
      return {
        ok: false,
        error: {
          kind: "already_promoted",
          noteId: highlight.promotedToNoteId
        } as const
      };
    }
    const [source] = await tx
      .select()
      .from(sources)
      .where(eq(sources.id, highlight.sourceId));
    if (!source) return { ok: false, error: { kind: "not_found" } as const };

    const defaultTitle =
      `${source.title}: ${highlight.text.slice(0, 60).trim()}`.slice(0, 200);
    const title = input.titleOverride ?? defaultTitle;

    const [note] = await tx
      .insert(notes)
      .values({
        type: "literature",
        title,
        bodyMd: highlight.text + (highlight.noteText ? `\n\n> ${highlight.noteText}` : "")
      })
      .returning();

    await tx
      .insert(noteSources)
      .values({ noteId: note!.id, sourceId: source.id });

    await tx
      .update(highlights)
      .set({ promotedToNoteId: note!.id })
      .where(eq(highlights.id, input.highlightId));

    return { ok: true, result: { noteId: note!.id } };
  });
}
```

- [ ] **Step 4: Create `apps/api/src/routes/highlights.ts`**

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { notes } from "@zk/db-schema";
import { db } from "../db/client";
import { zodErrorHook } from "../lib/zod-error-hook";
import { notFound, conflict } from "../lib/errors";
import { promoteHighlight } from "../lib/promote-highlight";

export const highlightsRoute = new Hono();

const ParamSchema = z.object({ id: z.string().uuid() });
const BodySchema = z.object({ title: z.string().optional() });

highlightsRoute.post(
  "/:id/promote",
  zValidator("param", ParamSchema, zodErrorHook),
  zValidator("json", BodySchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const { title } = c.req.valid("json");

    const outcome = await promoteHighlight(db, {
      highlightId: id,
      titleOverride: title
    });

    if (!outcome.ok) {
      if (outcome.error.kind === "not_found") throw notFound("highlight", id);
      throw conflict(
        `highlight already promoted to note ${outcome.error.noteId}`
      );
    }

    const [row] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, outcome.result.noteId));
    if (!row) throw notFound("note", outcome.result.noteId);
    return c.json(
      {
        id: row.id,
        type: row.type,
        title: row.title,
        body_md: row.bodyMd,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString()
      },
      201
    );
  }
);
```

- [ ] **Step 5: Mount the route in `apps/api/src/server.ts`**

Read the file. Add to imports:

```ts
import { highlightsRoute } from "./routes/highlights";
```

Add an `app.route` line near the other mounts:

```ts
app.route("/api/highlights", highlightsRoute);
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — 4 new highlight tests; all 78 prior API tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): promote highlight to literature note endpoint"
```

---

## Task 6: Inbox endpoint — include un-promoted highlights

Extend `GET /api/inbox` so the `highlights` array is populated with un-promoted, un-dismissed highlights (with their source title).

**Files:**
- Modify: `apps/api/src/routes/inbox.ts`
- Modify: `apps/api/tests/inbox.test.ts`

- [ ] **Step 1: Append failing test to `apps/api/tests/inbox.test.ts`**

Inside `describe("GET /api/inbox", ...)`:

```ts
  it("includes un-promoted highlights with their source title", async () => {
    const [source] = await db
      .insert(schema.sources)
      .values({ title: "Some Book" })
      .returning();
    const [highlight] = await db
      .insert(schema.highlights)
      .values({ sourceId: source!.id, text: "important quote" })
      .returning();

    const res = await app.request("/api/inbox");
    const body = (await res.json()) as {
      highlights: {
        id: string;
        text: string;
        source_title: string;
      }[];
    };
    expect(body.highlights).toHaveLength(1);
    expect(body.highlights[0]!.id).toBe(highlight!.id);
    expect(body.highlights[0]!.source_title).toBe("Some Book");
    expect(body.highlights[0]!.text).toBe("important quote");
  });

  it("excludes promoted and dismissed highlights", async () => {
    const [source] = await db
      .insert(schema.sources)
      .values({ title: "Book" })
      .returning();
    const [note] = await db
      .insert(schema.notes)
      .values({ type: "literature", title: "lit" })
      .returning();
    await db.insert(schema.highlights).values({
      sourceId: source!.id,
      text: "promoted",
      promotedToNoteId: note!.id
    });
    await db.insert(schema.highlights).values({
      sourceId: source!.id,
      text: "dismissed",
      dismissedAt: new Date()
    });
    await db.insert(schema.highlights).values({
      sourceId: source!.id,
      text: "untouched"
    });

    const res = await app.request("/api/inbox");
    const body = (await res.json()) as {
      highlights: { text: string }[];
    };
    expect(body.highlights.map((h) => h.text)).toEqual(["untouched"]);
  });
```

(Make sure to update the import at the top of `inbox.test.ts` so `schema` includes `sources` and `highlights`: it imports `* as schema from "@zk/db-schema"` after Task 1.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test inbox`
Expected: FAIL — `highlights` array is still `[]`.

- [ ] **Step 3: Update `apps/api/src/routes/inbox.ts`** — query and return highlights

Read the file. Update the imports — add `sources`, `highlights`, `desc`:

```ts
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notes, spacedReview, sources, highlights } from "@zk/db-schema";
```

Replace the handler body. After computing `fleetingRows`, add a highlights query:

```ts
  const highlightRows = await db
    .select({
      id: highlights.id,
      text: highlights.text,
      source_title: sources.title,
      source_id: sources.id
    })
    .from(highlights)
    .innerJoin(sources, eq(sources.id, highlights.sourceId))
    .where(
      and(
        isNull(highlights.promotedToNoteId),
        isNull(highlights.dismissedAt)
      )
    )
    .orderBy(desc(highlights.createdAt))
    .limit(50);

  return c.json({
    due: dueRows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      next_due_at: r.next_due_at.toISOString()
    })),
    fleeting: fleetingRows,
    highlights: highlightRows
  });
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test inbox`
Expected: PASS — 4 inbox tests total (2 prior + 2 new); all other tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): inbox endpoint surfaces un-promoted highlights with source"
```

---

## Task 7: Readwise worker package scaffold

Mirrors `apps/mirror`'s shape. No sync logic yet (Tasks 8-10).

**Files:**
- Create: `apps/readwise/package.json`
- Create: `apps/readwise/tsconfig.json`
- Create: `apps/readwise/vitest.config.ts`
- Create: `apps/readwise/src/env.ts`
- Create: `apps/readwise/src/index.ts` (stub)
- Modify: root `package.json` — add `dev:readwise`

- [ ] **Step 1: Create `apps/readwise/package.json`**

```json
{
  "name": "@zk/readwise",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@zk/db-schema": "workspace:*",
    "drizzle-orm": "^0.36.4",
    "postgres": "^3.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create `apps/readwise/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*", "vitest.config.ts"],
  "references": [{ "path": "../../packages/db-schema" }]
}
```

- [ ] **Step 3: Create `apps/readwise/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true }
    }
  }
});
```

- [ ] **Step 4: Create `apps/readwise/src/env.ts`**

```ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://zk:zk@localhost:5433/zettel"),
  DATABASE_URL_TEST: z
    .string()
    .url()
    .default("postgres://zk:zk@localhost:5433/zettel_test"),
  READWISE_TOKEN: z.string().optional(),
  READWISE_BASE_URL: z.string().default("https://readwise.io/api/v2"),
  READWISE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(6 * 60 * 60 * 1000)
});

const raw = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  READWISE_TOKEN: process.env.READWISE_TOKEN,
  READWISE_BASE_URL: process.env.READWISE_BASE_URL,
  READWISE_INTERVAL_MS: process.env.READWISE_INTERVAL_MS
};

export const env = EnvSchema.parse(raw);

export function dbUrl(): string {
  return env.NODE_ENV === "test" ? env.DATABASE_URL_TEST : env.DATABASE_URL;
}
```

- [ ] **Step 5: Create stub `apps/readwise/src/index.ts`**

```ts
import { env } from "./env";

if (!env.READWISE_TOKEN) {
  console.error(
    "readwise: READWISE_TOKEN not set — worker cannot sync. Exiting."
  );
  process.exit(1);
}

console.log(
  `readwise: configured (interval=${env.READWISE_INTERVAL_MS}ms) — sync loop not implemented yet (Task 10)`
);
```

- [ ] **Step 6: Add `dev:readwise` to root `package.json`**

Read the root `package.json`. Add the script:

```json
"scripts": {
  "dev:api": "pnpm --filter @zk/api dev",
  "dev:web": "pnpm --filter @zk/web dev",
  "dev:mirror": "pnpm --filter @zk/mirror dev",
  "dev:readwise": "pnpm --filter @zk/readwise dev",
  "test": "pnpm -r --workspace-concurrency=1 test",
  "build": "pnpm -r build",
  "db:up": "docker compose up -d postgres redis",
  "db:down": "docker compose down",
  "db:reset": "docker compose down -v && docker compose up -d postgres redis"
}
```

- [ ] **Step 7: Install + typecheck**

```bash
pnpm install
pnpm --filter @zk/readwise typecheck
```

Both clean.

- [ ] **Step 8: Commit**

```bash
git add apps/readwise package.json pnpm-lock.yaml
git commit -m "feat(readwise): package scaffold (env, vitest, tsconfig)"
```

---

## Task 8: Readwise API client

A typed wrapper around `node:fetch` that hits Readwise's v2 export endpoint and parses responses with Zod.

**Files:**
- Create: `apps/readwise/src/client.ts`
- Create: `apps/readwise/tests/client.test.ts`

- [ ] **Step 1: Write failing test `apps/readwise/tests/client.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readwiseClient } from "../src/client";

describe("readwiseClient.exportHighlights", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("sends Authorization header and parses one page", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          count: 1,
          nextPageCursor: null,
          results: [
            {
              user_book_id: 12345,
              title: "Some Book",
              author: "Some Author",
              category: "books",
              source_url: null,
              asin: null,
              highlights: [
                {
                  id: 67890,
                  text: "highlight one",
                  note: "my note",
                  location: 42,
                  location_type: "order",
                  highlighted_at: "2026-05-15T10:00:00Z",
                  color: "yellow"
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const client = readwiseClient({
      token: "test-token",
      baseUrl: "https://readwise.io/api/v2"
    });
    const result = await client.exportHighlights();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, reqInit] = fetchMock.mock.calls[0]!;
    expect(reqUrl).toBe("https://readwise.io/api/v2/export/");
    expect(
      (reqInit as RequestInit).headers as Record<string, string>
    ).toMatchObject({ Authorization: "Token test-token" });

    expect(result.books).toHaveLength(1);
    expect(result.books[0]!.title).toBe("Some Book");
    expect(result.books[0]!.highlights[0]!.text).toBe("highlight one");
    expect(result.nextPageCursor).toBeNull();
  });

  it("paginates via pageCursor", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ count: 0, nextPageCursor: "abc", results: [] }),
        { status: 200 }
      )
    );
    const client = readwiseClient({
      token: "t",
      baseUrl: "https://readwise.io/api/v2"
    });
    await client.exportHighlights({ pageCursor: "xyz" });
    expect(fetchMock.mock.calls[0]![0]).toContain("pageCursor=xyz");
  });

  it("throws on non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );
    const client = readwiseClient({
      token: "bad",
      baseUrl: "https://readwise.io/api/v2"
    });
    await expect(client.exportHighlights()).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm --filter @zk/readwise test client`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/readwise/src/client.ts`**

```ts
import { z } from "zod";

const HighlightSchema = z.object({
  id: z.number(),
  text: z.string(),
  note: z.string().nullable().optional(),
  location: z.number().nullable().optional(),
  location_type: z.string().nullable().optional(),
  highlighted_at: z.string().nullable().optional(),
  color: z.string().nullable().optional()
});

const BookSchema = z.object({
  user_book_id: z.number(),
  title: z.string(),
  author: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  asin: z.string().nullable().optional(),
  highlights: z.array(HighlightSchema)
});

const ExportResponse = z.object({
  count: z.number(),
  nextPageCursor: z.string().nullable(),
  results: z.array(BookSchema)
});

export type ReadwiseHighlight = z.infer<typeof HighlightSchema>;
export type ReadwiseBook = z.infer<typeof BookSchema>;

export interface ReadwiseClient {
  exportHighlights(opts?: {
    pageCursor?: string;
    updatedAfter?: string;
  }): Promise<{
    books: ReadwiseBook[];
    nextPageCursor: string | null;
  }>;
}

export function readwiseClient(opts: {
  token: string;
  baseUrl: string;
}): ReadwiseClient {
  return {
    async exportHighlights({ pageCursor, updatedAfter } = {}) {
      const url = new URL(`${opts.baseUrl}/export/`);
      if (pageCursor) url.searchParams.set("pageCursor", pageCursor);
      if (updatedAfter) url.searchParams.set("updatedAfter", updatedAfter);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Token ${opts.token}`,
          Accept: "application/json"
        }
      });
      if (!res.ok) {
        throw new Error(
          `readwise: export request failed (${res.status} ${res.statusText})`
        );
      }
      const json = await res.json();
      const parsed = ExportResponse.parse(json);
      return {
        books: parsed.results,
        nextPageCursor: parsed.nextPageCursor
      };
    }
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/readwise test`
Expected: PASS — 3 client tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/readwise
git commit -m "feat(readwise): typed API client for the export endpoint"
```

---

## Task 9: Sync logic — upsert source + insert highlights

**Files:**
- Create: `apps/readwise/src/sync.ts`
- Create: `apps/readwise/tests/sync.test.ts`

- [ ] **Step 1: Write failing test `apps/readwise/tests/sync.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql, eq } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import { runSync } from "../src/sync";
import type { ReadwiseBook } from "../src/client";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

beforeEach(async () => {
  await db.execute(
    rawSql`TRUNCATE TABLE note_source, highlight, source, spaced_review, note_tag, note_link, tag, note RESTART IDENTITY CASCADE`
  );
});

afterAll(async () => {
  await client.end();
});

function makeFakeClient(pages: { books: ReadwiseBook[]; nextPageCursor: string | null }[]) {
  let i = 0;
  return {
    async exportHighlights() {
      const p = pages[i] ?? { books: [], nextPageCursor: null };
      i++;
      return p;
    }
  };
}

const sampleBook: ReadwiseBook = {
  user_book_id: 12345,
  title: "Foucault",
  author: "Michel Foucault",
  category: "books",
  source_url: null,
  asin: null,
  highlights: [
    {
      id: 1,
      text: "First highlight",
      note: null,
      location: 10,
      location_type: "order",
      highlighted_at: "2026-05-15T10:00:00Z",
      color: "yellow"
    },
    {
      id: 2,
      text: "Second highlight",
      note: "with note",
      location: 20,
      location_type: "order",
      highlighted_at: "2026-05-15T11:00:00Z",
      color: "blue"
    }
  ]
};

describe("runSync", () => {
  it("upserts source by readwise_book_id and inserts new highlights", async () => {
    const fakeClient = makeFakeClient([{ books: [sampleBook], nextPageCursor: null }]);
    const result = await runSync(url, fakeClient);
    expect(result.sourcesUpserted).toBe(1);
    expect(result.highlightsInserted).toBe(2);

    const sourceRows = await db.select().from(schema.sources);
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]!.title).toBe("Foucault");
    expect(sourceRows[0]!.readwiseBookId).toBe("12345");

    const highlightRows = await db.select().from(schema.highlights);
    expect(highlightRows).toHaveLength(2);
    expect(highlightRows.map((h) => h.text).sort()).toEqual([
      "First highlight",
      "Second highlight"
    ]);
  });

  it("is idempotent on a second run with the same data", async () => {
    const client1 = makeFakeClient([{ books: [sampleBook], nextPageCursor: null }]);
    await runSync(url, client1);
    const client2 = makeFakeClient([{ books: [sampleBook], nextPageCursor: null }]);
    const result = await runSync(url, client2);
    expect(result.highlightsInserted).toBe(0);

    const sourceRows = await db.select().from(schema.sources);
    expect(sourceRows).toHaveLength(1);
    const highlightRows = await db.select().from(schema.highlights);
    expect(highlightRows).toHaveLength(2);
  });

  it("paginates across pages", async () => {
    const fakeClient = makeFakeClient([
      { books: [sampleBook], nextPageCursor: "next" },
      {
        books: [
          {
            ...sampleBook,
            user_book_id: 99999,
            title: "Another Book",
            highlights: [
              {
                id: 99,
                text: "Other highlight",
                note: null,
                location: 1,
                location_type: "order",
                highlighted_at: null,
                color: null
              }
            ]
          }
        ],
        nextPageCursor: null
      }
    ]);
    const result = await runSync(url, fakeClient);
    expect(result.sourcesUpserted).toBe(2);
    expect(result.highlightsInserted).toBe(3);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm --filter @zk/readwise test sync`
Expected: FAIL.

- [ ] **Step 3: Create `apps/readwise/src/sync.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { sources, highlights } from "@zk/db-schema";
import type { ReadwiseClient, ReadwiseBook } from "./client";

export interface SyncResult {
  sourcesUpserted: number;
  highlightsInserted: number;
}

export async function runSync(
  databaseUrl: string,
  client: ReadwiseClient
): Promise<SyncResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(sql, { schema: { sources, highlights } });

    let sourcesUpserted = 0;
    let highlightsInserted = 0;
    let cursor: string | undefined = undefined;

    do {
      const page = await client.exportHighlights({ pageCursor: cursor });
      for (const book of page.books) {
        const sourceId = await upsertSource(db, book);
        sourcesUpserted++;
        highlightsInserted += await insertHighlights(db, sourceId, book);
      }
      cursor = page.nextPageCursor ?? undefined;
    } while (cursor);

    return { sourcesUpserted, highlightsInserted };
  } finally {
    await sql.end();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertSource(db: any, book: ReadwiseBook): Promise<string> {
  const readwiseBookId = String(book.user_book_id);
  const [existing] = await db
    .select()
    .from(sources)
    .where(eq(sources.readwiseBookId, readwiseBookId));
  if (existing) {
    await db
      .update(sources)
      .set({
        title: book.title,
        author: book.author ?? null,
        sourceType: book.category ?? null,
        url: book.source_url ?? null,
        isbn: book.asin ?? null,
        updatedAt: new Date()
      })
      .where(eq(sources.id, existing.id));
    return existing.id;
  }
  const [inserted] = await db
    .insert(sources)
    .values({
      title: book.title,
      author: book.author ?? null,
      sourceType: book.category ?? null,
      url: book.source_url ?? null,
      isbn: book.asin ?? null,
      readwiseBookId
    })
    .returning({ id: sources.id });
  return inserted!.id;
}

async function insertHighlights(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sourceId: string,
  book: ReadwiseBook
): Promise<number> {
  let inserted = 0;
  for (const h of book.highlights) {
    const readwiseHighlightId = String(h.id);
    const result = await db
      .insert(highlights)
      .values({
        sourceId,
        text: h.text,
        noteText: h.note ?? null,
        location: h.location !== undefined && h.location !== null ? String(h.location) : null,
        color: h.color ?? null,
        readwiseHighlightId
      })
      .onConflictDoNothing({ target: highlights.readwiseHighlightId })
      .returning({ id: highlights.id });
    if (result.length > 0) inserted++;
  }
  return inserted;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/readwise test`
Expected: PASS — 3 sync + 3 client = 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/readwise
git commit -m "feat(readwise): sync logic with idempotent upsert and pagination"
```

---

## Task 10: Worker entrypoint

**Files:**
- Modify: `apps/readwise/src/index.ts`

- [ ] **Step 1: Replace `apps/readwise/src/index.ts`**

```ts
import { env, dbUrl } from "./env";
import { readwiseClient } from "./client";
import { runSync } from "./sync";

if (!env.READWISE_TOKEN) {
  console.error(
    "readwise: READWISE_TOKEN not set — worker cannot sync. Exiting."
  );
  process.exit(1);
}

const client = readwiseClient({
  token: env.READWISE_TOKEN,
  baseUrl: env.READWISE_BASE_URL
});

let inFlight = false;

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await runSync(dbUrl(), client);
    if (result.highlightsInserted > 0 || result.sourcesUpserted > 0) {
      console.log(
        `readwise: synced ${result.sourcesUpserted} sources, ${result.highlightsInserted} new highlights`
      );
    }
  } catch (err) {
    console.error("readwise: sync failed:", err);
  } finally {
    inFlight = false;
  }
}

console.log(
  `readwise: starting (interval=${env.READWISE_INTERVAL_MS}ms)`
);

void tick();
setInterval(tick, env.READWISE_INTERVAL_MS);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @zk/readwise typecheck`
Expected: clean.

- [ ] **Step 3: Smoke test (without token, should exit)**

```bash
pnpm dev:readwise & READWISE_PID=$!; sleep 2; kill $READWISE_PID 2>/dev/null; wait $READWISE_PID 2>/dev/null
```

Expected: prints the "READWISE_TOKEN not set" error and exits with code 1.

- [ ] **Step 4: Commit**

```bash
git add apps/readwise/src/index.ts
git commit -m "feat(readwise): worker entrypoint with setInterval"
```

---

## Task 11: Web — promote highlight from inbox

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/components/InboxHighlightsPane.tsx`
- Modify: `apps/web/src/routes/inbox.tsx`

- [ ] **Step 1: Add `promoteHighlight` to `apps/web/src/lib/api-client.ts`**

Read the file. Add after the existing methods:

```ts
promoteHighlight(
  highlightId: string,
  titleOverride?: string
): Promise<Note> {
  return request(`/api/highlights/${highlightId}/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(titleOverride ? { title: titleOverride } : {})
  });
}
```

- [ ] **Step 2: Replace `apps/web/src/components/InboxHighlightsPane.tsx`**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { api } from "../lib/api-client";

interface HighlightItem {
  id: string;
  text: string;
  source_title: string;
}

interface InboxHighlightsPaneProps {
  items: HighlightItem[];
}

export function InboxHighlightsPane({ items }: InboxHighlightsPaneProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const promoteMutation = useMutation({
    mutationFn: (highlightId: string) => api.promoteHighlight(highlightId),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/notes/$noteId", params: { noteId: note.id } });
    }
  });

  return (
    <div className="inbox-pane">
      <h3>Highlights ({items.length})</h3>
      {items.length === 0 ? (
        <p className="inbox-empty">
          No un-promoted highlights. Start the readwise worker or check back later.
        </p>
      ) : (
        items.map((h) => {
          const rowPending = promoteMutation.variables === h.id;
          return (
            <div key={h.id} className="inbox-row">
              <div className="inbox-row-title" style={{ display: "flex", flexDirection: "column" }}>
                <span>{h.text}</span>
                <span style={{ color: "#888", fontSize: 11 }}>
                  from {h.source_title}
                </span>
              </div>
              <div className="inbox-row-actions">
                <button
                  onClick={() => promoteMutation.mutate(h.id)}
                  disabled={rowPending}
                >
                  Promote
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `apps/web/src/routes/inbox.tsx`** — pass new shape

Read the file. The `InboxHighlightsPane` is already wired; it now receives the updated shape (`source_title` added). No structural change needed because the route passes `inboxQuery.data.highlights` and TypeScript follows the api-client's return shape. Verify the file compiles.

If TypeScript complains, the api-client's `getInbox` return type needs an update. Read `apps/web/src/lib/api-client.ts` and find `getInbox`. Update the return type's `highlights` field:

```ts
highlights: { id: string; text: string; source_title: string }[];
```

- [ ] **Step 4: Typecheck and tests**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

Run: `pnpm --filter @zk/web test`
Expected: 9 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): promote highlights from inbox to literature notes"
```

---

## Task 12: Literature note — source block in detail page

When viewing a literature note, show a pinned block at the top with the source title + a link to the original highlight (if available).

**Files:**
- Modify: `apps/api/src/routes/notes.ts` — include `sources: [...]` on GET /api/notes/:id when type=literature
- Modify: `apps/api/tests/notes.test.ts` — assertion
- Modify: `packages/shared/src/note.ts` — Note schema gains `sources` field
- Modify: `apps/web/src/components/NoteEditor.tsx` (or detail route) — show source block
- Create: `apps/web/src/components/LiteratureSourceBlock.tsx`

- [ ] **Step 1: Update `packages/shared/src/note.ts`** — add `sources` to `NoteSchema`

Read the file. Find `NoteSchema`. Add a `sources` field:

```ts
export const NoteSchema = z.object({
  id: z.string().uuid(),
  type: NoteType,
  title: z.string(),
  body_md: z.string().nullable(),
  tags: z.array(z.string()),
  sources: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      author: z.string().nullable(),
      url: z.string().nullable()
    })
  ),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  archived_at: z.string().datetime().nullable(),
  notion_page_id: z.string().nullable()
});
```

- [ ] **Step 2: Update existing test fixture that parses NoteSchema**

In `packages/shared/tests/note.test.ts`, find the "parses a full note record" test. Add `sources: []` to the fixture:

```ts
const note = NoteSchema.parse({
  id: "550e8400-e29b-41d4-a716-446655440000",
  type: "permanent",
  title: "Idea",
  body_md: "Body",
  tags: ["focus"],
  sources: [],
  created_at: "2026-05-15T10:00:00.000Z",
  updated_at: "2026-05-15T10:00:00.000Z",
  archived_at: null,
  notion_page_id: null
});
```

Run `pnpm --filter @zk/shared test` to confirm green.

- [ ] **Step 3: Update `apps/api/src/routes/notes.ts`** — fetch and include sources

Read the file. Add `noteSources, sources` to the schema import:

```ts
import { notes, noteTags, tags, noteSources, sources } from "@zk/db-schema";
```

Add a helper `fetchSourcesFor` near `fetchTagsFor`:

```ts
async function fetchSourcesFor(
  noteIds: string[]
): Promise<Map<string, { id: string; title: string; author: string | null; url: string | null }[]>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db
    .select({
      noteId: noteSources.noteId,
      id: sources.id,
      title: sources.title,
      author: sources.author,
      url: sources.url
    })
    .from(noteSources)
    .innerJoin(sources, eq(sources.id, noteSources.sourceId))
    .where(inArray(noteSources.noteId, noteIds));
  const map = new Map<string, { id: string; title: string; author: string | null; url: string | null }[]>();
  for (const r of rows) {
    const existing = map.get(r.noteId);
    const entry = { id: r.id, title: r.title, author: r.author, url: r.url };
    if (existing) existing.push(entry);
    else map.set(r.noteId, [entry]);
  }
  return map;
}
```

Update `serializeNote` to accept and return sources:

```ts
function serializeNote(
  row: typeof notes.$inferSelect,
  tagNames: string[] = [],
  sources: { id: string; title: string; author: string | null; url: string | null }[] = []
) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body_md: row.bodyMd,
    tags: tagNames.sort(),
    sources,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
    notion_page_id: row.notionPageId
  };
}
```

Update each handler that calls `serializeNote` to also pass the sources map:

- List handler (`notesRoute.get("/")`):

```ts
const tagsByNote = await fetchTagsFor(rows.map((r) => r.id));
const sourcesByNote = await fetchSourcesFor(rows.map((r) => r.id));
return c.json({
  notes: rows.map((r) =>
    serializeNote(r, tagsByNote.get(r.id) ?? [], sourcesByNote.get(r.id) ?? [])
  )
});
```

(Same pattern for the `?ids=` branch.)

- Get-one handler:

```ts
const tagsByNote = await fetchTagsFor([id]);
const sourcesByNote = await fetchSourcesFor([id]);
return c.json(
  serializeNote(row, tagsByNote.get(id) ?? [], sourcesByNote.get(id) ?? [])
);
```

- POST + PATCH handlers: pass `[]` for sources (a newly-created note has none; PATCH gets fresh data):

```ts
return c.json(serializeNote(created, [], []), 201);  // POST
```

```ts
const tagsByNote = await fetchTagsFor([id]);
const sourcesByNote = await fetchSourcesFor([id]);
return c.json(
  serializeNote(updated, tagsByNote.get(id) ?? [], sourcesByNote.get(id) ?? [])
);
```

- [ ] **Step 4: Append test to `apps/api/tests/notes.test.ts`**

Inside `describe("GET /api/notes/:id", ...)`:

```ts
  it("includes sources on a literature note linked via note_source", async () => {
    const litRes = await post("/api/notes", {
      title: "Lit",
      type: "literature"
    });
    const lit = (await litRes.json()) as { id: string };
    const [source] = await db
      .insert(schema.sources)
      .values({ title: "BookTitle", author: "Author X" })
      .returning();
    await db
      .insert(schema.noteSources)
      .values({ noteId: lit.id, sourceId: source!.id });

    const res = await app.request(`/api/notes/${lit.id}`);
    const note = (await res.json()) as {
      sources: { title: string; author: string | null }[];
    };
    expect(note.sources).toHaveLength(1);
    expect(note.sources[0]!.title).toBe("BookTitle");
    expect(note.sources[0]!.author).toBe("Author X");
  });
```

(Add `schema` import at top of test file if not present: `import * as schema from "@zk/db-schema";`)

- [ ] **Step 5: Create `apps/web/src/components/LiteratureSourceBlock.tsx`**

```tsx
import type { Note } from "@zk/shared";

interface LiteratureSourceBlockProps {
  sources: Note["sources"];
}

export function LiteratureSourceBlock({ sources }: LiteratureSourceBlockProps) {
  if (sources.length === 0) return null;
  return (
    <div
      style={{
        background: "#161616",
        border: "1px solid #222",
        borderRadius: 4,
        padding: 12,
        marginTop: 12,
        marginBottom: 12,
        fontSize: 13
      }}
    >
      <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", marginBottom: 6 }}>
        Source
      </div>
      {sources.map((s) => (
        <div key={s.id}>
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
          ) : (
            s.title
          )}
          {s.author && (
            <span style={{ color: "#888" }}> — {s.author}</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Wire `LiteratureSourceBlock` into `apps/web/src/routes/notes.$noteId.tsx`**

Read the file. Add import:

```ts
import { LiteratureSourceBlock } from "../components/LiteratureSourceBlock";
```

Find the JSX that renders the `<input>` title. Add the source block above the title input (only for literature notes):

```tsx
<NoteTopBar note={noteQuery.data} onBack={() => router.history.back()} />

{noteQuery.data.type === "literature" && (
  <LiteratureSourceBlock sources={noteQuery.data.sources} />
)}

<input
  value={title}
  ...
/>
```

- [ ] **Step 7: Run all tests + typecheck**

```bash
pnpm test
pnpm -r typecheck
```

Both clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api apps/web packages/shared
git commit -m "feat: literature notes show source block in detail view"
```

---

## Task 13: End-to-end verification + README

- [ ] **Step 1: Full workspace test**

Run: `pnpm test`
Expected counts:
- shared: 22 (+ small adjustments for sources field)
- api: ~87 (78 baseline + 4 highlight promote + 2 inbox highlights + 1 source on get + 2 schema-extract no-changes ≈ 87)
- mirror: 14 (12 + 1 unchanged-write + 1 escape control chars)
- web: 9
- readwise: 6 (3 client + 3 sync)
- **Total ≈ 138**

- [ ] **Step 2: Workspace typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional)**

If you have a Readwise token:

```bash
READWISE_TOKEN=xxxxx READWISE_INTERVAL_MS=30000 pnpm dev:readwise &
READWISE_PID=$!
sleep 35
kill $READWISE_PID 2>/dev/null
```

Open `http://localhost:5173/inbox` → highlights pane should show un-promoted highlights with source titles. Click Promote → navigates to the new literature note, which has the source block at the top.

- [ ] **Step 4: Update `README.md`**

Find the "Current status" section. Replace with:

```markdown
## Current status

M1 Plans 1–5 complete. The stack supports note + link + tag CRUD, a CodeMirror 6 markdown editor with `[[wikilink]]` autocomplete and decoration, a backlinks panel with note titles, inline tag editing, a ⌘K command palette over Postgres FTS, a Sigma.js graph view at `/graph`, a triage inbox at `/inbox` with spaced-repetition daily review, fleeting-note promotion, and Readwise-highlight promotion, a markdown mirror worker that writes every note to `~/Notes/zettel/` with git auto-commits, and a Readwise sync worker that pulls highlights into the inbox.
```

Append the readwise script to the setup block:

```markdown
pnpm dev:readwise  # readwise sync (requires READWISE_TOKEN env var)
```

Append to "Layout":

```markdown
- `apps/readwise` — Readwise sync worker (highlights → inbox)
- `packages/db-schema` — Drizzle schema shared by api, mirror, readwise
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update readme for M1 Plan 5 completion"
```

---

## Verification checklist (final, post-implementation)

- [ ] `pnpm test` passes (~138 tests).
- [ ] `pnpm -r typecheck` is clean.
- [ ] `apps/api`, `apps/mirror`, `apps/readwise` all import schema from `@zk/db-schema` — no cross-app relative imports.
- [ ] Manual readwise smoke (with token): one tick pulls highlights into the DB and they appear in `/inbox`.
- [ ] Manual promote smoke: clicking Promote on a highlight creates a literature note with the source linked and the highlight's `promoted_to_note_id` set.
- [ ] Literature note detail view shows the source block.

---

## What's deliberately NOT in this plan

- **Dismiss a highlight** (mark `dismissed_at` so it disappears from inbox without becoming a note) — defer to a later polish pass
- **Multiple sources per literature note** — schema supports it (`note_source` is many-to-many), but the UI shows just the first/all without editing
- **Bulk highlight promote** — one-at-a-time only
- **Highlight color filters** in the inbox — defer
- **Readwise Reader articles (vs Kindle highlights)** — both come through the same `/export/` endpoint, so they'd work automatically, but no UI affordance distinguishes them
- **Source editing UI** — the user can hand-edit the source via API or psql until a later plan
- **Citation export** — Plan 6 (or later) when the dissertation writing surface becomes a concern
- **ML lit-note classifier** ("promote-worthy?") — Plan M3
- **Notion import** — Plan 6

These are non-blocking, deliberate deferrals.
