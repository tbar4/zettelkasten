# Mirror & Inbox Implementation Plan (M1, Plan 4 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a markdown-mirror worker that writes every note as a YAML-frontmatter `.md` file under `~/Notes/zettel/` and auto-commits a git history of changes. Add a triage inbox at `/inbox` with a spaced-repetition daily-review pane and a fleeting-notes pane (promote/archive). Front-load three Plan 3 carry-overs.

**Architecture:** A new `apps/mirror` package runs a periodic sweep (default 5 min) that reconciles the database state with `~/Notes/zettel/`: creates new files, rewrites changed ones, deletes orphaned ones, and commits the diff in a single git operation. A `spaced_review` table tracks one row per permanent note with `next_due_at` and `interval_days`. The `/inbox` route surfaces what's due today, plus fleeting notes the user hasn't processed.

**Tech Stack:** `simple-git` for git operations, native `fs/promises` for file I/O, hand-rolled YAML serializer (the frontmatter shape is fixed and small). No new web deps.

---

## File Structure

```
apps/api/src/
├── db/
│   ├── schema.ts                                   (modify) — spaced_review table
│   └── migrations/0003_spaced_review.sql           (generated)
├── lib/
│   └── spaced-review.ts                            (create) — schedule + action helpers
└── routes/
    ├── notes.ts                                    (modify) — schedule on permanent create/promote
    ├── inbox.ts                                    (create) — GET /api/inbox
    └── review.ts                                   (create) — POST /api/notes/:id/review

apps/web/src/
├── routes/
│   ├── __root.tsx                                  (modify) — add /inbox nav
│   └── inbox.tsx                                   (create) — inbox UI
├── components/
│   ├── CommandPalette.tsx                          (modify) — namespaced query key
│   ├── TagEditor.tsx                               (modify) — chip-remove race fix
│   ├── InboxReviewPane.tsx                         (create) — today's review
│   ├── InboxFleetingPane.tsx                       (create) — fleeting + promote
│   └── InboxHighlightsPane.tsx                     (create) — placeholder pane
└── lib/
    └── api-client.ts                               (modify) — getInbox, postReview,
                                                              promoteToPermanent, listNotesByIds slim mode

apps/mirror/                                        (new package)
├── package.json                                    (create)
├── tsconfig.json                                   (create)
├── vitest.config.ts                                (create)
├── src/
│   ├── index.ts                                    (create) — entrypoint
│   ├── sweep.ts                                    (create) — DB ↔ FS reconciliation
│   ├── slug.ts                                     (create) — title → slug
│   ├── frontmatter.ts                              (create) — serialize/deserialize
│   ├── git.ts                                      (create) — git add + commit
│   └── env.ts                                      (create) — config
└── tests/
    ├── slug.test.ts                                (create)
    ├── frontmatter.test.ts                         (create)
    └── sweep.test.ts                               (create) — DB-backed integration

package.json                                        (modify) — dev:mirror script
```

**Why this layout**

- `apps/mirror` is a separate Node process because it has its own lifecycle (long-lived, periodic) and shouldn't share the API's exit conditions. Sharing schema and DB client is fine via workspace imports.
- `apps/api/src/lib/spaced-review.ts` keeps scheduling logic out of route handlers — the same logic fires from note create AND from the promote action.
- `InboxReviewPane` / `InboxFleetingPane` / `InboxHighlightsPane` are separate components because each owns its own query and its own action set; collapsing them produces one giant component that's hard to extend.
- `git.ts` wraps `simple-git` rather than calling it inline — keeps the sweep logic readable and makes git mocking possible in unit tests.

---

## Conventions

- **Postgres on `localhost:5433`**.
- **Mirror writes to `$ZK_MIRROR_DIR` (default `~/Notes/zettel`)**. Created if missing; initialized as a git repo on first run.
- **TDD** — failing test, then implementation. Each task commits.
- **Drizzle 0.36 array-form** for table extras.
- **noUncheckedIndexedAccess** on; `!.` non-null assertions remain the established pattern.

---

## Task 1: CommandPalette query-key namespace (Plan 3 carry-over)

`CommandPalette` uses `["palette-search", q]` — outside the `["notes"]` namespace, so mutations don't invalidate it. Bring it inside the namespace so renames refresh.

**Files:**
- Modify: `apps/web/src/components/CommandPalette.tsx`

- [ ] **Step 1: Update the queryKey in `apps/web/src/components/CommandPalette.tsx`**

Find:

```ts
const resultsQuery = useQuery({
  queryKey: ["palette-search", q],
  queryFn: () => api.searchNotes(q),
  enabled: open
});
```

Replace with:

```ts
const resultsQuery = useQuery({
  queryKey: ["notes", "search", q],
  queryFn: () => api.searchNotes(q),
  enabled: open
});
```

- [ ] **Step 2: Typecheck and tests**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

Run: `pnpm --filter @zk/web test`
Expected: 9 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/CommandPalette.tsx
git commit -m "fix(web): namespace palette query key under [\"notes\", ...] for invalidations"
```

---

## Task 2: TagEditor chip-remove race fix (Plan 3 carry-over)

Two rapid chip removes can race: each computes its `filter(...)` from the same stale prop snapshot. Fix by disabling chip removes during pending mutation (same gate as the input).

**Files:**
- Modify: `apps/web/src/components/TagEditor.tsx`

- [ ] **Step 1: Read the current `apps/web/src/components/TagEditor.tsx`**

Locate the `<button type="button" className="tag-chip-remove" onClick={() => removeTag(t)} ...>` element.

- [ ] **Step 2: Add the disabled attribute**

Find this block (inside the `tags.map(...)`):

```tsx
<button
  type="button"
  className="tag-chip-remove"
  onClick={() => removeTag(t)}
  aria-label={`Remove tag ${t}`}
>
  ×
</button>
```

Replace with:

```tsx
<button
  type="button"
  className="tag-chip-remove"
  onClick={() => removeTag(t)}
  aria-label={`Remove tag ${t}`}
  disabled={setTagsMutation.isPending}
>
  ×
</button>
```

- [ ] **Step 3: Typecheck and tests**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

Run: `pnpm --filter @zk/web test`
Expected: 9 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/TagEditor.tsx
git commit -m "fix(web): disable chip-remove during pending tag mutation to prevent race"
```

---

## Task 3: listNotesByIds slim mode (Plan 3 carry-over)

`LinksPanel` only needs `{id, title, type}` from `listNotesByIds`, but the endpoint pulls full notes and joins tags. Add a slim mode via `?fields=id,title,type` and pass it from the web client.

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/components/LinksPanel.tsx`
- Modify: `apps/api/tests/notes.test.ts`

- [ ] **Step 1: Append failing tests to `apps/api/tests/notes.test.ts`** — inside `describe("GET /api/notes", ...)`

```ts
  it("respects ?fields= for slim responses", async () => {
    const a = (await (
      await post("/api/notes", { title: "Slim", type: "permanent" })
    ).json()) as { id: string };

    const res = await app.request(
      `/api/notes?ids=${a.id}&fields=id,title,type`
    );
    const body = (await res.json()) as { notes: Record<string, unknown>[] };
    expect(body.notes).toHaveLength(1);
    expect(Object.keys(body.notes[0]!).sort()).toEqual(["id", "title", "type"]);
  });
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `pnpm --filter @zk/api test notes`
Expected: FAIL — full Note shape returned.

- [ ] **Step 3: Update `apps/api/src/routes/notes.ts`** — accept `fields=id,title,type` and skip the tag join when slim

Find the `ListQuerySchema`:

```ts
const ListQuerySchema = z.object({
  type: NoteType.optional(),
  ids: z.string().optional(),
  include_archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
});
```

Replace with:

```ts
const ListQuerySchema = z.object({
  type: NoteType.optional(),
  ids: z.string().optional(),
  fields: z.string().optional(),
  include_archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
});
```

Inside the handler, update the `ids` branch. Find:

```ts
if (ids !== undefined) {
  const idList = ids
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (idList.length === 0) return c.json({ notes: [] });
  const rows = await db
    .select()
    .from(notes)
    .where(inArray(notes.id, idList))
    .orderBy(desc(notes.createdAt));
  const tagsByNote = await fetchTagsFor(rows.map((r) => r.id));
  return c.json({
    notes: rows.map((r) => serializeNote(r, tagsByNote.get(r.id) ?? []))
  });
}
```

Replace with:

```ts
if (ids !== undefined) {
  const idList = ids
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (idList.length === 0) return c.json({ notes: [] });

  if (fields === "id,title,type") {
    const rows = await db
      .select({ id: notes.id, title: notes.title, type: notes.type })
      .from(notes)
      .where(inArray(notes.id, idList));
    return c.json({ notes: rows });
  }

  const rows = await db
    .select()
    .from(notes)
    .where(inArray(notes.id, idList))
    .orderBy(desc(notes.createdAt));
  const tagsByNote = await fetchTagsFor(rows.map((r) => r.id));
  return c.json({
    notes: rows.map((r) => serializeNote(r, tagsByNote.get(r.id) ?? []))
  });
}
```

(Only `id,title,type` is supported as a slim shape for now — any other `fields` value falls through to the full shape. Future plans can generalize.)

- [ ] **Step 4: Update `apps/web/src/lib/api-client.ts`** — accept a slim mode

Find:

```ts
listNotesByIds(ids: string[]): Promise<{ notes: Note[] }> {
  if (ids.length === 0) return Promise.resolve({ notes: [] });
  return request(
    `/api/notes?ids=${ids.map(encodeURIComponent).join(",")}`,
    { method: "GET" }
  );
},
```

Replace with:

```ts
listNotesByIds(ids: string[]): Promise<{ notes: Note[] }> {
  if (ids.length === 0) return Promise.resolve({ notes: [] });
  return request(
    `/api/notes?ids=${ids.map(encodeURIComponent).join(",")}`,
    { method: "GET" }
  );
},

listNoteSummariesByIds(
  ids: string[]
): Promise<{ notes: Pick<Note, "id" | "title" | "type">[] }> {
  if (ids.length === 0) return Promise.resolve({ notes: [] });
  return request(
    `/api/notes?ids=${ids.map(encodeURIComponent).join(",")}&fields=id,title,type`,
    { method: "GET" }
  );
},
```

- [ ] **Step 5: Update `apps/web/src/components/LinksPanel.tsx`** — call the slim variant

Find:

```ts
const titlesQuery = useQuery({
  queryKey: ["notes", "titles", allReferencedIds],
  queryFn: () => api.listNotesByIds(allReferencedIds),
  enabled: allReferencedIds.length > 0
});
```

Replace with:

```ts
const titlesQuery = useQuery({
  queryKey: ["notes", "titles", allReferencedIds],
  queryFn: () => api.listNoteSummariesByIds(allReferencedIds),
  enabled: allReferencedIds.length > 0
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: PASS — new API test green, prior tests pass, web tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api apps/web
git commit -m "perf(api): slim fields=id,title,type mode for LinksPanel batch fetch"
```

---

## Task 4: spaced_review table + migration

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Generated: `apps/api/src/db/migrations/0003_spaced_review.sql`

- [ ] **Step 1: Update `apps/api/src/db/schema.ts`** — add `spacedReview` table

Read the file. After the existing tables (notes, noteLinks, tags, noteTags), add:

```ts
export const spacedReview = pgTable(
  "spaced_review",
  {
    noteId: uuid("note_id")
      .primaryKey()
      .references(() => notes.id, { onDelete: "cascade" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
    intervalDays: integer("interval_days").notNull().default(1)
  },
  (t) => [index("spaced_review_next_due_idx").on(t.nextDueAt)]
);
```

Add `integer` to the imports at the top of the file:

```ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
  check,
  customType,
  integer
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @zk/api exec drizzle-kit generate --name=spaced_review`
Expected: a new file `apps/api/src/db/migrations/0003_spaced_review.sql` containing the CREATE TABLE + CREATE INDEX statements.

- [ ] **Step 3: Apply migration to both DBs**

```bash
pnpm --filter @zk/api db:migrate
NODE_ENV=test pnpm --filter @zk/api db:migrate
```

Both should print `Migrations complete.`

- [ ] **Step 4: Verify**

Run: `docker exec zk-postgres psql -U zk -d zettel -c "\d spaced_review"`
Expected: shows the four columns plus an index on `next_due_at`.

- [ ] **Step 5: Run existing tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — all 68 prior tests still green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations
git commit -m "feat(api): spaced_review table for daily-review queue"
```

---

## Task 5: Spaced-review scheduling & actions

Three behaviors:
- When a **permanent** note is created, insert a `spaced_review` row with `interval_days=1, next_due_at=now+1d`
- When a fleeting note is **promoted** to permanent (via PATCH `{type: "permanent"}`), insert a `spaced_review` row the same way
- `POST /api/notes/:id/review` with `{action: "keep" | "archive"}` updates the row (`keep`: bumps interval) or archives the note (`archive`: archives note + deletes row)

The interval ladder is `[1, 3, 7, 14, 30, 90]` (days). Past 90, stays at 90.

**Files:**
- Create: `apps/api/src/lib/spaced-review.ts`
- Create: `apps/api/src/routes/review.ts`
- Modify: `apps/api/src/routes/notes.ts` — call `scheduleReview` on relevant write paths
- Modify: `apps/api/src/server.ts` — mount the review route
- Create: `apps/api/tests/spaced-review.test.ts`

- [ ] **Step 1: Write failing test `apps/api/tests/spaced-review.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { app } from "../src/server";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("spaced review scheduling", () => {
  it("creates a spaced_review row when a permanent note is created", async () => {
    const created = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };
    const rows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.intervalDays).toBe(1);
  });

  it("creates a spaced_review row when a fleeting is promoted to permanent", async () => {
    const created = (await (
      await post("/api/notes", { title: "F", type: "fleeting" })
    ).json()) as { id: string; updated_at: string };
    expect(
      (await db
        .select()
        .from(schema.spacedReview)
        .where(eq(schema.spacedReview.noteId, created.id))).length
    ).toBe(0);

    await app.request(`/api/notes/${created.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": created.updated_at
      },
      body: JSON.stringify({ type: "permanent" })
    });

    const rows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(rows).toHaveLength(1);
  });

  it("does NOT create a spaced_review row for non-permanent notes", async () => {
    const created = (await (
      await post("/api/notes", { title: "F", type: "fleeting" })
    ).json()) as { id: string };
    const rows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(rows).toEqual([]);
  });
});

describe("POST /api/notes/:id/review", () => {
  it("keep action bumps interval to next step (1→3)", async () => {
    const created = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };

    const res = await post(`/api/notes/${created.id}/review`, {
      action: "keep"
    });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(rows[0]!.intervalDays).toBe(3);
  });

  it("archive action archives the note and removes the spaced_review row", async () => {
    const created = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };

    const res = await post(`/api/notes/${created.id}/review`, {
      action: "archive"
    });
    expect(res.status).toBe(204);

    const reviewRows = await db
      .select()
      .from(schema.spacedReview)
      .where(eq(schema.spacedReview.noteId, created.id));
    expect(reviewRows).toEqual([]);

    const noteRows = await db
      .select()
      .from(schema.notes)
      .where(eq(schema.notes.id, created.id));
    expect(noteRows[0]!.archivedAt).not.toBeNull();
  });

  it("returns 404 for an unknown note id", async () => {
    const res = await post(
      "/api/notes/550e8400-e29b-41d4-a716-446655440099/review",
      { action: "keep" }
    );
    expect(res.status).toBe(404);
  });

  it("400 on unknown action", async () => {
    const created = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };
    const res = await post(`/api/notes/${created.id}/review`, {
      action: "delete"
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test spaced-review`
Expected: FAIL — nothing implemented yet.

- [ ] **Step 3: Create `apps/api/src/lib/spaced-review.ts`**

```ts
import { eq } from "drizzle-orm";
import { notes, spacedReview } from "../db/schema";

const LADDER = [1, 3, 7, 14, 30, 90];

function nextInterval(current: number): number {
  const idx = LADDER.indexOf(current);
  if (idx === -1) return LADDER[0]!;
  return LADDER[Math.min(idx + 1, LADDER.length - 1)]!;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

type TxLike = {
  insert: (...args: never[]) => unknown;
  update: (...args: never[]) => unknown;
  delete: (...args: never[]) => unknown;
  select: (...args: never[]) => unknown;
};

export async function scheduleReview(
  // The looser type lets us pass either the main db or a transaction handle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  noteId: string
): Promise<void> {
  const now = new Date();
  await db
    .insert(spacedReview)
    .values({
      noteId,
      lastSeenAt: now,
      nextDueAt: addDays(now, LADDER[0]!),
      intervalDays: LADDER[0]!
    })
    .onConflictDoNothing({ target: spacedReview.noteId });
}

export async function applyKeep(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  noteId: string
): Promise<{ intervalDays: number; nextDueAt: Date } | null> {
  const [existing] = await db
    .select()
    .from(spacedReview)
    .where(eq(spacedReview.noteId, noteId));
  if (!existing) return null;
  const newInterval = nextInterval(existing.intervalDays);
  const now = new Date();
  const [updated] = await db
    .update(spacedReview)
    .set({
      lastSeenAt: now,
      nextDueAt: addDays(now, newInterval),
      intervalDays: newInterval
    })
    .where(eq(spacedReview.noteId, noteId))
    .returning();
  return updated
    ? { intervalDays: updated.intervalDays, nextDueAt: updated.nextDueAt }
    : null;
}

export async function applyArchive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  noteId: string
): Promise<boolean> {
  const archived = await db
    .update(notes)
    .set({ archivedAt: new Date() })
    .where(eq(notes.id, noteId))
    .returning({ id: notes.id });
  if (archived.length === 0) return false;
  await db.delete(spacedReview).where(eq(spacedReview.noteId, noteId));
  return true;
}
```

(The `any`-typed `db` parameter is intentional — `syncWikilinks` from Plan 2 took the same approach for the same reason: accepting either the top-level db or a transaction handle requires a structural type that Drizzle doesn't expose cleanly. The implementer-flow established this pattern in commit `0ae6c55`.)

- [ ] **Step 4: Update `apps/api/src/routes/notes.ts`** — schedule on permanent create + on fleeting→permanent promotion

Read the file. Add to the imports:

```ts
import { scheduleReview } from "../lib/spaced-review";
```

In the POST handler, find the transaction block. After `await syncWikilinks(tx, row!.id, row!.bodyMd);` and inside the transaction, schedule when type is permanent:

```ts
const created = await db.transaction(async (tx) => {
  const [row] = await tx
    .insert(notes)
    .values({
      type: input.type,
      title: input.title,
      bodyMd: input.body_md ?? null
    })
    .returning();
  await syncWikilinks(tx, row!.id, row!.bodyMd);
  if (row!.type === "permanent") {
    await scheduleReview(tx, row!.id);
  }
  return row!;
});
```

In the PATCH handler, find the transaction block. After `await syncWikilinks(tx, id, row!.bodyMd);` (which is inside an `if (update.body_md !== undefined)` guard), add a separate guard for type→permanent promotion:

```ts
const updated = await db.transaction(async (tx) => {
  const [row] = await tx
    .update(notes)
    .set({
      ...(update.title !== undefined ? { title: update.title } : {}),
      ...(update.type !== undefined ? { type: update.type } : {}),
      ...(update.body_md !== undefined ? { bodyMd: update.body_md } : {}),
      updatedAt: new Date()
    })
    .where(eq(notes.id, id))
    .returning();
  if (update.body_md !== undefined) {
    await syncWikilinks(tx, id, row!.bodyMd);
  }
  if (update.type === "permanent" && existing.type !== "permanent") {
    await scheduleReview(tx, id);
  }
  return row!;
});
```

(`existing` is already in scope from the optimistic-concurrency check earlier in the handler.)

- [ ] **Step 5: Create `apps/api/src/routes/review.ts`**

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/client";
import { zodErrorHook } from "../lib/zod-error-hook";
import { notFound } from "../lib/errors";
import { applyKeep, applyArchive } from "../lib/spaced-review";

export const reviewRoute = new Hono();

const ParamSchema = z.object({ id: z.string().uuid() });
const ActionSchema = z.object({ action: z.enum(["keep", "archive"]) });

reviewRoute.post(
  "/:id/review",
  zValidator("param", ParamSchema, zodErrorHook),
  zValidator("json", ActionSchema, zodErrorHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const { action } = c.req.valid("json");

    if (action === "archive") {
      const archived = await applyArchive(db, id);
      if (!archived) throw notFound("note", id);
      return c.body(null, 204);
    }

    const updated = await applyKeep(db, id);
    if (!updated) throw notFound("note", id);
    return c.json({
      interval_days: updated.intervalDays,
      next_due_at: updated.nextDueAt.toISOString()
    });
  }
);
```

- [ ] **Step 6: Mount the route in `apps/api/src/server.ts`**

Read the file. Add to imports:

```ts
import { reviewRoute } from "./routes/review";
```

Add an `app.route` line near the existing route mounts (after the existing `app.route("/api/notes", noteTagsRoute);`):

```ts
app.route("/api/notes", reviewRoute);
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — 5 new tests green; all 69 prior API tests still pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): spaced-review scheduling and keep/archive actions"
```

---

## Task 6: GET /api/inbox endpoint

Returns the three panes the UI needs in one call: `due` (notes due for review today), `fleeting` (unprocessed fleeting notes), `highlights` (placeholder empty array — Plan 5 wires it).

**Files:**
- Create: `apps/api/src/routes/inbox.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/tests/inbox.test.ts`

- [ ] **Step 1: Write failing test `apps/api/tests/inbox.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { app } from "../src/server";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("GET /api/inbox", () => {
  it("returns due notes, fleeting notes, and an empty highlights array", async () => {
    const due = (await (
      await post("/api/notes", { title: "DueNote", type: "permanent" })
    ).json()) as { id: string };
    // Force its next_due_at to the past so it's due now.
    await db
      .update(schema.spacedReview)
      .set({ nextDueAt: sql`now() - interval '1 day'` })
      .where(eq(schema.spacedReview.noteId, due.id));

    const fleeting = (await (
      await post("/api/notes", { title: "FleetingNote", type: "fleeting" })
    ).json()) as { id: string };

    // A permanent note with future due date should NOT appear under due.
    await post("/api/notes", { title: "FutureDue", type: "permanent" });

    const res = await app.request("/api/inbox");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      due: { id: string; title: string }[];
      fleeting: { id: string; title: string }[];
      highlights: unknown[];
    };
    expect(body.due.map((n) => n.id)).toEqual([due.id]);
    expect(body.fleeting.map((n) => n.id)).toEqual([fleeting.id]);
    expect(body.highlights).toEqual([]);
  });

  it("excludes archived notes from both panes", async () => {
    const f = (await (
      await post("/api/notes", { title: "F", type: "fleeting" })
    ).json()) as { id: string };
    await app.request(`/api/notes/${f.id}`, { method: "DELETE" });

    const p = (await (
      await post("/api/notes", { title: "P", type: "permanent" })
    ).json()) as { id: string };
    await db
      .update(schema.spacedReview)
      .set({ nextDueAt: sql`now() - interval '1 day'` })
      .where(eq(schema.spacedReview.noteId, p.id));
    await app.request(`/api/notes/${p.id}`, { method: "DELETE" });

    const res = await app.request("/api/inbox");
    const body = (await res.json()) as {
      due: unknown[];
      fleeting: unknown[];
    };
    expect(body.due).toEqual([]);
    expect(body.fleeting).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test inbox`
Expected: FAIL — `/api/inbox` doesn't exist.

- [ ] **Step 3: Create `apps/api/src/routes/inbox.ts`**

```ts
import { Hono } from "hono";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notes, spacedReview } from "../db/schema";

export const inboxRoute = new Hono();

inboxRoute.get("/", async (c) => {
  const dueRows = await db
    .select({
      id: notes.id,
      title: notes.title,
      type: notes.type,
      next_due_at: spacedReview.nextDueAt
    })
    .from(spacedReview)
    .innerJoin(notes, eq(notes.id, spacedReview.noteId))
    .where(and(lte(spacedReview.nextDueAt, sql`now()`), isNull(notes.archivedAt)))
    .orderBy(asc(spacedReview.nextDueAt))
    .limit(20);

  const fleetingRows = await db
    .select({ id: notes.id, title: notes.title, type: notes.type })
    .from(notes)
    .where(and(eq(notes.type, "fleeting"), isNull(notes.archivedAt)))
    .orderBy(desc(notes.createdAt))
    .limit(50);

  return c.json({
    due: dueRows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      next_due_at: r.next_due_at.toISOString()
    })),
    fleeting: fleetingRows,
    highlights: [] as { id: string; text: string }[]
  });
});
```

- [ ] **Step 4: Mount the route in `apps/api/src/server.ts`**

Read the file. Add to imports:

```ts
import { inboxRoute } from "./routes/inbox";
```

Add an `app.route` line after the existing route mounts:

```ts
app.route("/api/inbox", inboxRoute);
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — 2 new inbox tests green; all 74 prior tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): inbox endpoint with due/fleeting/highlights panes"
```

---

## Task 7: `apps/mirror` package scaffold

Set up the workspace package, deps, tsconfig, and vitest config — no logic yet.

**Files:**
- Create: `apps/mirror/package.json`
- Create: `apps/mirror/tsconfig.json`
- Create: `apps/mirror/vitest.config.ts`
- Create: `apps/mirror/src/index.ts` (stub)
- Create: `apps/mirror/src/env.ts`
- Modify: root `package.json` — add `dev:mirror` script

- [ ] **Step 1: Create `apps/mirror/package.json`**

```json
{
  "name": "@zk/mirror",
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
    "@zk/shared": "workspace:*",
    "drizzle-orm": "^0.36.4",
    "postgres": "^3.4.5",
    "simple-git": "^3.27.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create `apps/mirror/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "noEmit": false
  },
  "include": ["src/**/*", "tests/**/*", "vitest.config.ts"],
  "references": [{ "path": "../../packages/shared" }]
}
```

- [ ] **Step 3: Create `apps/mirror/vitest.config.ts`**

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

- [ ] **Step 4: Create `apps/mirror/src/env.ts`**

```ts
import { z } from "zod";
import { homedir } from "os";
import { join } from "path";

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
  ZK_MIRROR_DIR: z.string().default(join(homedir(), "Notes", "zettel")),
  ZK_MIRROR_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000)
});

const raw = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_TEST: process.env.DATABASE_URL_TEST,
  ZK_MIRROR_DIR: process.env.ZK_MIRROR_DIR,
  ZK_MIRROR_INTERVAL_MS: process.env.ZK_MIRROR_INTERVAL_MS
};

export const env = EnvSchema.parse(raw);

export function dbUrl(): string {
  return env.NODE_ENV === "test" ? env.DATABASE_URL_TEST : env.DATABASE_URL;
}
```

- [ ] **Step 5: Create stub `apps/mirror/src/index.ts`**

```ts
import { env } from "./env";

console.log(
  `mirror: configured for ${env.ZK_MIRROR_DIR} every ${env.ZK_MIRROR_INTERVAL_MS}ms`
);
console.log("mirror: sweep loop not implemented yet (Task 10)");
```

- [ ] **Step 6: Update the root `package.json`** — add `dev:mirror`

Read the file. Find the `scripts` block and add `dev:mirror`:

```json
"scripts": {
  "dev:api": "pnpm --filter @zk/api dev",
  "dev:web": "pnpm --filter @zk/web dev",
  "dev:mirror": "pnpm --filter @zk/mirror dev",
  "test": "pnpm -r test",
  "build": "pnpm -r build",
  "db:up": "docker compose up -d postgres redis",
  "db:down": "docker compose down",
  "db:reset": "docker compose down -v && docker compose up -d postgres redis"
}
```

- [ ] **Step 7: Install**

Run: `pnpm install`
Expected: success. If pnpm complains about new build scripts (`simple-git` should not need any), add them to `allowBuilds:` in `pnpm-workspace.yaml`.

- [ ] **Step 8: Smoke-test**

Run: `pnpm --filter @zk/mirror exec node -e "import('./src/env.js').catch(e => console.log('skip-import: ts-only'))"`

(That will fail because `env.ts` isn't compiled; we just want to confirm the package resolves.)

Better verification: run `pnpm --filter @zk/mirror typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/mirror package.json pnpm-lock.yaml
git commit -m "feat(mirror): package scaffold (env, vitest, tsconfig)"
```

---

## Task 8: Mirror — slug derivation

**Files:**
- Create: `apps/mirror/src/slug.ts`
- Create: `apps/mirror/tests/slug.test.ts`

- [ ] **Step 1: Write failing test `apps/mirror/tests/slug.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { slugify, fileNameFor } from "../src/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips punctuation and accents", () => {
    expect(slugify("Café—Résumé!")).toBe("cafe-resume");
  });

  it("returns 'untitled' for empty/whitespace input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("   ")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("foo --- bar")).toBe("foo-bar");
  });

  it("truncates to 80 chars", () => {
    expect(slugify("a".repeat(120)).length).toBe(80);
  });
});

describe("fileNameFor", () => {
  it("combines slug and short id suffix", () => {
    expect(
      fileNameFor("Hello World", "550e8400-e29b-41d4-a716-446655440000")
    ).toBe("hello-world-550e8400.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zk/mirror test slug`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/mirror/src/slug.ts`**

```ts
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return base || "untitled";
}

export function fileNameFor(title: string, id: string): string {
  return `${slugify(title)}-${id.slice(0, 8)}.md`;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/mirror test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mirror
git commit -m "feat(mirror): slug derivation and filename builder"
```

---

## Task 9: Mirror — frontmatter serialization

**Files:**
- Create: `apps/mirror/src/frontmatter.ts`
- Create: `apps/mirror/tests/frontmatter.test.ts`

- [ ] **Step 1: Write failing test `apps/mirror/tests/frontmatter.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { serialize } from "../src/frontmatter";

const fixedDate = new Date("2026-05-15T10:00:00.000Z");

describe("frontmatter.serialize", () => {
  it("serializes a permanent note with body, tags, and links", () => {
    const out = serialize({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "permanent",
      title: 'A Note: "Quoted"',
      bodyMd: "Body text.\n\nSecond paragraph.",
      tags: ["alpha", "beta"],
      links: [
        {
          toId: "550e8400-e29b-41d4-a716-446655440001",
          linkType: "supports",
          context: null
        }
      ],
      createdAt: fixedDate,
      updatedAt: fixedDate
    });
    expect(out).toContain('id: "550e8400-e29b-41d4-a716-446655440000"');
    expect(out).toContain("type: permanent");
    expect(out).toContain('title: "A Note: \\"Quoted\\""');
    expect(out).toContain("tags:");
    expect(out).toContain("  - alpha");
    expect(out).toContain("  - beta");
    expect(out).toContain("links:");
    expect(out).toContain("    to: 550e8400-e29b-41d4-a716-446655440001");
    expect(out).toContain("    type: supports");
    expect(out).toMatch(/---\n\nBody text\.\n\nSecond paragraph\./);
  });

  it("omits tags and links when empty", () => {
    const out = serialize({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "permanent",
      title: "Simple",
      bodyMd: "x",
      tags: [],
      links: [],
      createdAt: fixedDate,
      updatedAt: fixedDate
    });
    expect(out).not.toContain("tags:");
    expect(out).not.toContain("links:");
  });

  it("handles topic notes (no body)", () => {
    const out = serialize({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "topic",
      title: "Topic",
      bodyMd: null,
      tags: [],
      links: [],
      createdAt: fixedDate,
      updatedAt: fixedDate
    });
    // Topic notes have no body after the frontmatter, but the closing --- and
    // a trailing newline are still present.
    expect(out.endsWith("---\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zk/mirror test frontmatter`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/mirror/src/frontmatter.ts`**

```ts
export interface SerializeInput {
  id: string;
  type: "fleeting" | "literature" | "permanent" | "topic";
  title: string;
  bodyMd: string | null;
  tags: string[];
  links: Array<{
    toId: string;
    linkType: string;
    context: string | null;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

function quoteString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function serialize(input: SerializeInput): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${quoteString(input.id)}`);
  lines.push(`type: ${input.type}`);
  lines.push(`title: ${quoteString(input.title)}`);
  if (input.tags.length > 0) {
    lines.push("tags:");
    for (const t of input.tags) lines.push(`  - ${t}`);
  }
  if (input.links.length > 0) {
    lines.push("links:");
    for (const l of input.links) {
      lines.push("  - ");
      lines.push(`    to: ${l.toId}`);
      lines.push(`    type: ${l.linkType}`);
      if (l.context !== null) {
        lines.push(`    context: ${quoteString(l.context)}`);
      }
    }
  }
  lines.push(`created_at: ${input.createdAt.toISOString()}`);
  lines.push(`updated_at: ${input.updatedAt.toISOString()}`);
  lines.push("---");
  lines.push("");

  if (input.type === "topic" || input.bodyMd === null) {
    return lines.join("\n") + "\n";
  }
  return lines.join("\n") + "\n" + input.bodyMd + "\n";
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/mirror test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mirror
git commit -m "feat(mirror): YAML frontmatter serializer"
```

---

## Task 10: Mirror — sweep logic + git auto-commit

The core: read all notes from the DB, compute desired files, diff against the filesystem, apply changes, commit.

**Files:**
- Create: `apps/mirror/src/git.ts`
- Create: `apps/mirror/src/sweep.ts`
- Modify: `apps/mirror/src/index.ts` (wire to setInterval)
- Create: `apps/mirror/tests/sweep.test.ts`

- [ ] **Step 1: Create `apps/mirror/src/git.ts`**

```ts
import simpleGit, { type SimpleGit } from "simple-git";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";

export async function openOrInitRepo(dir: string): Promise<SimpleGit> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const git = simpleGit(dir);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    await git.init();
    await git.addConfig("user.name", "zk mirror");
    await git.addConfig("user.email", "mirror@zk.local");
  }
  return git;
}

export async function commitAll(
  git: SimpleGit,
  message: string
): Promise<boolean> {
  const status = await git.status();
  if (status.isClean()) return false;
  await git.add(".");
  await git.commit(message);
  return true;
}
```

- [ ] **Step 2: Create `apps/mirror/src/sweep.ts`**

```ts
import { readdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  notes,
  noteLinks,
  noteTags,
  tags
} from "../../api/src/db/schema";
import { fileNameFor } from "./slug";
import { serialize } from "./frontmatter";
import { openOrInitRepo, commitAll } from "./git";

export interface SweepResult {
  written: number;
  deleted: number;
  committed: boolean;
}

type Schema = {
  notes: typeof notes;
  noteLinks: typeof noteLinks;
  noteTags: typeof noteTags;
  tags: typeof tags;
};

const schema: Schema = { notes, noteLinks, noteTags, tags };

export async function runSweep(
  databaseUrl: string,
  mirrorDir: string
): Promise<SweepResult> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(sql, { schema });

    // 1. Snapshot desired state from DB.
    const noteRows = await db
      .select()
      .from(notes)
      .where(isNull(notes.archivedAt));
    const ids = noteRows.map((n) => n.id);

    const tagRows =
      ids.length === 0
        ? []
        : await db
            .select({ noteId: noteTags.noteId, name: tags.name })
            .from(noteTags)
            .innerJoin(tags, eq(tags.id, noteTags.tagId))
            .where(inArray(noteTags.noteId, ids));
    const tagsByNote = new Map<string, string[]>();
    for (const r of tagRows) {
      const existing = tagsByNote.get(r.noteId);
      if (existing) existing.push(r.name);
      else tagsByNote.set(r.noteId, [r.name]);
    }

    const linkRows =
      ids.length === 0
        ? []
        : await db
            .select({
              fromId: noteLinks.fromNoteId,
              toId: noteLinks.toNoteId,
              linkType: noteLinks.linkType,
              context: noteLinks.context
            })
            .from(noteLinks)
            .where(inArray(noteLinks.fromNoteId, ids));
    const linksByNote = new Map<
      string,
      { toId: string; linkType: string; context: string | null }[]
    >();
    for (const l of linkRows) {
      const existing = linksByNote.get(l.fromId);
      const entry = { toId: l.toId, linkType: l.linkType, context: l.context };
      if (existing) existing.push(entry);
      else linksByNote.set(l.fromId, [entry]);
    }

    // 2. Compute desired filenames + contents.
    const desired = new Map<string, string>(); // filename -> content
    for (const n of noteRows) {
      const name = fileNameFor(n.title, n.id);
      const content = serialize({
        id: n.id,
        type: n.type,
        title: n.title,
        bodyMd: n.bodyMd,
        tags: (tagsByNote.get(n.id) ?? []).sort(),
        links: linksByNote.get(n.id) ?? [],
        createdAt: n.createdAt,
        updatedAt: n.updatedAt
      });
      desired.set(name, content);
    }

    // 3. Ensure the mirror dir is a git repo.
    const git = await openOrInitRepo(mirrorDir);

    // 4. Walk current files in the dir; compute writes and deletes.
    const existing = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    let written = 0;
    let deleted = 0;

    for (const [name, content] of desired) {
      await writeFile(join(mirrorDir, name), content, "utf8");
      written++;
    }
    for (const f of existing) {
      if (!desired.has(f)) {
        await unlink(join(mirrorDir, f));
        deleted++;
      }
    }

    // 5. Commit if anything changed.
    const summary = `zk: sweep (${written} notes, ${deleted} deletions)`;
    const committed = await commitAll(git, summary);

    return { written, deleted, committed };
  } finally {
    await sql.end();
  }
}
```

(Note: the import of `notes, noteLinks, noteTags, tags` from `../../api/src/db/schema` works because workspace projects share TypeScript paths. The `apps/mirror/tsconfig.json` doesn't explicitly reference apps/api, but TypeScript resolves the path through node-modules-style resolution — Drizzle schema is just normal TypeScript. If the import doesn't resolve, add `"paths": { "../../api/*": ["../api/*"] }` or copy the schema fields needed; the simplest fix is to add `references: [{ path: "../api" }]` though apps/api isn't a `composite` project. Easiest path: write a local `apps/mirror/src/schema-mirror.ts` that re-exports the four tables — see Step 3 below.)

- [ ] **Step 3: Workaround — create `apps/mirror/src/schema-mirror.ts` that re-exports the API's schema**

The direct relative import in Step 2's sweep.ts will fail under TypeScript's project boundaries. Replace the import in `sweep.ts` with a local re-export module. Create:

```ts
// apps/mirror/src/schema-mirror.ts
export {
  notes,
  noteLinks,
  noteTags,
  tags
} from "../../api/src/db/schema";
```

Then in `sweep.ts`, replace:

```ts
import {
  notes,
  noteLinks,
  noteTags,
  tags
} from "../../api/src/db/schema";
```

with:

```ts
import { notes, noteLinks, noteTags, tags } from "./schema-mirror";
```

This indirection lets TypeScript resolve the relative path from `apps/mirror/src/` and keeps `sweep.ts` clean. If TypeScript still complains about boundaries, the alternative is to publish the schema from `@zk/shared` — defer that as a Plan 5 refactor.

- [ ] **Step 4: Wire setInterval in `apps/mirror/src/index.ts`**

Replace the stub with:

```ts
import { env, dbUrl } from "./env";
import { runSweep } from "./sweep";

let inFlight = false;

async function tick() {
  if (inFlight) return; // skip if previous sweep still running
  inFlight = true;
  try {
    const result = await runSweep(dbUrl(), env.ZK_MIRROR_DIR);
    if (result.committed) {
      console.log(
        `mirror: wrote ${result.written}, deleted ${result.deleted}, committed`
      );
    }
  } catch (err) {
    console.error("mirror: sweep failed:", err);
  } finally {
    inFlight = false;
  }
}

console.log(
  `mirror: starting (dir=${env.ZK_MIRROR_DIR}, interval=${env.ZK_MIRROR_INTERVAL_MS}ms)`
);

// Run once immediately, then on the interval.
void tick();
setInterval(tick, env.ZK_MIRROR_INTERVAL_MS);
```

- [ ] **Step 5: Write failing test `apps/mirror/tests/sweep.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "../../api/src/db/schema";
import { runSweep } from "../src/sweep";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

let mirrorDir = "";

beforeEach(async () => {
  await db.execute(
    rawSql`TRUNCATE TABLE note_tag, note_link, tag, note, spaced_review RESTART IDENTITY CASCADE`
  );
  if (mirrorDir) await rm(mirrorDir, { recursive: true, force: true });
  mirrorDir = await mkdtemp(join(tmpdir(), "zk-mirror-"));
});

afterAll(async () => {
  if (mirrorDir) await rm(mirrorDir, { recursive: true, force: true });
  await client.end();
});

describe("runSweep", () => {
  it("writes a file for each non-archived note", async () => {
    const [a] = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "A Note", bodyMd: "hello" })
      .returning();
    const result = await runSweep(url, mirrorDir);
    expect(result.written).toBe(1);
    expect(result.deleted).toBe(0);

    const files = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("a-note");
    expect(files[0]).toContain(a!.id.slice(0, 8));

    const content = await readFile(join(mirrorDir, files[0]!), "utf8");
    expect(content).toContain("type: permanent");
    expect(content).toContain('title: "A Note"');
    expect(content).toContain("hello");
  });

  it("deletes the file when a note is archived", async () => {
    const [a] = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "X", bodyMd: "y" })
      .returning();
    await runSweep(url, mirrorDir);
    expect((await readdir(mirrorDir)).filter((f) => f.endsWith(".md"))).toHaveLength(1);

    await db
      .update(schema.notes)
      .set({ archivedAt: new Date() })
      .where(rawSql`id = ${a!.id}`);
    const result = await runSweep(url, mirrorDir);
    expect(result.deleted).toBe(1);
    expect((await readdir(mirrorDir)).filter((f) => f.endsWith(".md"))).toEqual([]);
  });

  it("rewrites the file when title changes (old removed, new written)", async () => {
    const [a] = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Old Title" })
      .returning();
    await runSweep(url, mirrorDir);
    const before = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    expect(before[0]).toContain("old-title");

    await db
      .update(schema.notes)
      .set({ title: "New Title" })
      .where(rawSql`id = ${a!.id}`);
    await runSweep(url, mirrorDir);
    const after = (await readdir(mirrorDir)).filter((f) => f.endsWith(".md"));
    expect(after).toHaveLength(1);
    expect(after[0]).toContain("new-title");
    expect(after[0]).not.toContain("old-title");
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @zk/mirror test`
Expected: PASS — all 3 sweep tests green; slug + frontmatter tests still green.

- [ ] **Step 7: Smoke-test the dev loop**

```bash
ZK_MIRROR_DIR=$(mktemp -d) ZK_MIRROR_INTERVAL_MS=2000 pnpm dev:mirror &
MIRROR_PID=$!
sleep 4
echo "---listing temp dir---"
ls "$ZK_MIRROR_DIR" 2>/dev/null || echo "(empty)"
kill $MIRROR_PID 2>/dev/null
wait $MIRROR_PID 2>/dev/null
```

Expected: process starts, prints "starting" + initial sweep result, runs at least once. After kill, exit cleanly.

- [ ] **Step 8: Commit**

```bash
git add apps/mirror
git commit -m "feat(mirror): sweep logic with file reconciliation and git auto-commit"
```

---

## Task 11: Web — /inbox route shell + api client wiring

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/routes/__root.tsx` (add nav link)
- Create: `apps/web/src/routes/inbox.tsx`

- [ ] **Step 1: Extend `apps/web/src/lib/api-client.ts`** — add `getInbox`, `postReview`, `promoteToPermanent`

Read the file. Add methods after `getGraph`:

```ts
getInbox(): Promise<{
  due: { id: string; title: string; type: string; next_due_at: string }[];
  fleeting: { id: string; title: string; type: string }[];
  highlights: { id: string; text: string }[];
}> {
  return request("/api/inbox", { method: "GET" });
},

postReview(
  noteId: string,
  action: "keep" | "archive"
): Promise<void | { interval_days: number; next_due_at: string }> {
  return request(`/api/notes/${noteId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action })
  });
},

promoteToPermanent(noteId: string, ifMatch: string): Promise<Note> {
  return request(`/api/notes/${noteId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": ifMatch
    },
    body: JSON.stringify({ type: "permanent" })
  });
}
```

- [ ] **Step 2: Add an "Inbox" link to `apps/web/src/routes/__root.tsx`**

Read the file. Replace the existing `<header>` element with one that includes the new link between Zettelkasten title and Graph:

```tsx
<header style={{ marginBottom: 24, display: "flex", alignItems: "baseline", gap: 16 }}>
  <h1 style={{ margin: 0 }}>
    <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
      Zettelkasten
    </Link>
  </h1>
  <Link to="/inbox" style={{ fontSize: 14, color: "#7aa2f7" }}>
    Inbox
  </Link>
  <Link to="/graph" style={{ fontSize: 14, color: "#7aa2f7" }}>
    Graph
  </Link>
  <span style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>
    ⌘K to search
  </span>
</header>
```

- [ ] **Step 3: Create the route stub `apps/web/src/routes/inbox.tsx`**

(Will be expanded in Tasks 12-14 with actual panes.)

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/inbox")({
  component: InboxPage
});

function InboxPage() {
  return (
    <div>
      <h2>Inbox</h2>
      <p style={{ color: "#888" }}>Panes will appear here (Tasks 12-14).</p>
    </div>
  );
}
```

- [ ] **Step 4: Regenerate the route tree**

Run `pnpm --filter @zk/web dev` briefly in the background (8 seconds), then kill it. TanStack Router plugin updates `routeTree.gen.ts`.

```bash
pnpm --filter @zk/web dev &
DEV_PID=$!
sleep 8
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

- [ ] **Step 5: Typecheck and test**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

Run: `pnpm --filter @zk/web test`
Expected: 9 web tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): /inbox route shell + api client (getInbox, postReview, promoteToPermanent)"
```

---

## Task 12: Inbox — today's review pane

**Files:**
- Create: `apps/web/src/components/InboxReviewPane.tsx`
- Modify: `apps/web/src/routes/inbox.tsx`
- Modify: `apps/web/src/styles.css` — pane styles

- [ ] **Step 1: Append to `apps/web/src/styles.css`**

```css

.inbox-pane {
  background: #161616;
  border: 1px solid #222;
  border-radius: 4px;
  padding: 16px;
  margin-bottom: 16px;
}

.inbox-pane h3 {
  margin: 0 0 12px;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #aaa;
}

.inbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #222;
}

.inbox-row:last-child {
  border-bottom: 0;
}

.inbox-row-title {
  flex: 1;
  color: inherit;
  text-decoration: none;
}

.inbox-row-title:hover {
  text-decoration: underline;
}

.inbox-row-actions {
  display: flex;
  gap: 6px;
}

.inbox-row-actions button {
  font-size: 12px;
  padding: 2px 8px;
}

.inbox-empty {
  color: #555;
  font-size: 13px;
}
```

- [ ] **Step 2: Create `apps/web/src/components/InboxReviewPane.tsx`**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api-client";

interface ReviewItem {
  id: string;
  title: string;
  type: string;
  next_due_at: string;
}

interface InboxReviewPaneProps {
  items: ReviewItem[];
}

export function InboxReviewPane({ items }: InboxReviewPaneProps) {
  const qc = useQueryClient();

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      action
    }: {
      id: string;
      action: "keep" | "archive";
    }) => api.postReview(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  return (
    <div className="inbox-pane">
      <h3>Today's review ({items.length})</h3>
      {items.length === 0 ? (
        <p className="inbox-empty">Nothing due. Come back tomorrow.</p>
      ) : (
        items.map((n) => (
          <div key={n.id} className="inbox-row">
            <Link
              to="/notes/$noteId"
              params={{ noteId: n.id }}
              className="inbox-row-title"
            >
              {n.title}
            </Link>
            <span style={{ color: "#888", fontSize: 11 }}>{n.type}</span>
            <div className="inbox-row-actions">
              <button
                onClick={() => reviewMutation.mutate({ id: n.id, action: "keep" })}
                disabled={reviewMutation.isPending}
              >
                Keep
              </button>
              <button
                onClick={() => {
                  if (confirm("Archive this note?")) {
                    reviewMutation.mutate({ id: n.id, action: "archive" });
                  }
                }}
                disabled={reviewMutation.isPending}
              >
                Archive
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire into `apps/web/src/routes/inbox.tsx`**

Replace the file:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { InboxReviewPane } from "../components/InboxReviewPane";

export const Route = createFileRoute("/inbox")({
  component: InboxPage
});

function InboxPage() {
  const inboxQuery = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.getInbox()
  });

  if (inboxQuery.isLoading) return <p>Loading inbox…</p>;
  if (inboxQuery.isError || !inboxQuery.data)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load inbox: {String(inboxQuery.error)}
      </p>
    );

  return (
    <div>
      <h2>Inbox</h2>
      <InboxReviewPane items={inboxQuery.data.due} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and tests**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

Run: `pnpm --filter @zk/web test`
Expected: 9 web tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): InboxReviewPane wired into /inbox"
```

---

## Task 13: Inbox — fleeting pane with promote action

**Files:**
- Modify: `apps/web/src/lib/api-client.ts` — return updated_at-aware getNote already exists; promote uses if-match. We need to fetch notes' updated_at to promote.
- Create: `apps/web/src/components/InboxFleetingPane.tsx`
- Modify: `apps/web/src/routes/inbox.tsx`

- [ ] **Step 1: Create `apps/web/src/components/InboxFleetingPane.tsx`**

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

  // Promote requires the current updated_at for If-Match. Fetch lazily on click.
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

  return (
    <div className="inbox-pane">
      <h3>Fleeting ({items.length})</h3>
      {items.length === 0 ? (
        <p className="inbox-empty">No fleeting notes to process.</p>
      ) : (
        items.map((n) => (
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
                disabled={promoteMutation.isPending}
              >
                Promote
              </button>
              <button
                onClick={() => {
                  if (confirm("Archive this fleeting note?")) {
                    archiveMutation.mutate(n.id);
                  }
                }}
                disabled={archiveMutation.isPending}
              >
                Archive
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `apps/web/src/routes/inbox.tsx`**

Replace the file:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { InboxReviewPane } from "../components/InboxReviewPane";
import { InboxFleetingPane } from "../components/InboxFleetingPane";

export const Route = createFileRoute("/inbox")({
  component: InboxPage
});

function InboxPage() {
  const inboxQuery = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.getInbox()
  });

  if (inboxQuery.isLoading) return <p>Loading inbox…</p>;
  if (inboxQuery.isError || !inboxQuery.data)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load inbox: {String(inboxQuery.error)}
      </p>
    );

  return (
    <div>
      <h2>Inbox</h2>
      <InboxReviewPane items={inboxQuery.data.due} />
      <InboxFleetingPane items={inboxQuery.data.fleeting} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and tests**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

Run: `pnpm --filter @zk/web test`
Expected: 9 web tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): InboxFleetingPane with promote and archive actions"
```

---

## Task 14: Inbox — highlights placeholder pane

A stub pane that tells the user "Plan 5 will populate this." Wired now so the Plan 5 work just adds data, not UI.

**Files:**
- Create: `apps/web/src/components/InboxHighlightsPane.tsx`
- Modify: `apps/web/src/routes/inbox.tsx`

- [ ] **Step 1: Create `apps/web/src/components/InboxHighlightsPane.tsx`**

```tsx
interface HighlightItem {
  id: string;
  text: string;
}

interface InboxHighlightsPaneProps {
  items: HighlightItem[];
}

export function InboxHighlightsPane({ items }: InboxHighlightsPaneProps) {
  return (
    <div className="inbox-pane">
      <h3>Highlights ({items.length})</h3>
      {items.length === 0 ? (
        <p className="inbox-empty">
          No Readwise highlights yet. (Wired in M1 Plan 5.)
        </p>
      ) : (
        items.map((h) => (
          <div key={h.id} className="inbox-row">
            <span className="inbox-row-title">{h.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `apps/web/src/routes/inbox.tsx`**

Replace the file:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { InboxReviewPane } from "../components/InboxReviewPane";
import { InboxFleetingPane } from "../components/InboxFleetingPane";
import { InboxHighlightsPane } from "../components/InboxHighlightsPane";

export const Route = createFileRoute("/inbox")({
  component: InboxPage
});

function InboxPage() {
  const inboxQuery = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.getInbox()
  });

  if (inboxQuery.isLoading) return <p>Loading inbox…</p>;
  if (inboxQuery.isError || !inboxQuery.data)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load inbox: {String(inboxQuery.error)}
      </p>
    );

  return (
    <div>
      <h2>Inbox</h2>
      <InboxReviewPane items={inboxQuery.data.due} />
      <InboxFleetingPane items={inboxQuery.data.fleeting} />
      <InboxHighlightsPane items={inboxQuery.data.highlights} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and tests**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

Run: `pnpm --filter @zk/web test`
Expected: 9 web tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): InboxHighlightsPane placeholder for Plan 5"
```

---

## Task 15: End-to-end verification + README

- [ ] **Step 1: Run the full workspace test suite**

Run: `pnpm test`
Expected: all packages green. Approximate counts:
- `@zk/shared`: 22
- `@zk/api`: ~75 (68 baseline + 1 fields slim + 5 spaced-review + 2 inbox)
- `@zk/web`: 9
- `@zk/mirror`: ~10 (5 slug + 3 frontmatter + 3 sweep)
- **Total ≈ 116**

- [ ] **Step 2: Workspace typecheck**

Run: `pnpm -r typecheck`
Expected: clean across all four packages.

- [ ] **Step 3: Manual smoke** (optional — tests + typecheck are the primary safety net)

```bash
pnpm db:up
pnpm dev:api      # terminal 1
pnpm dev:web      # terminal 2
ZK_MIRROR_INTERVAL_MS=10000 pnpm dev:mirror  # terminal 3
```

In the browser:
- Visit `/inbox` — should render three panes
- Create a fleeting note via home page form; the Fleeting pane in /inbox should list it
- Click Promote on a fleeting → it disappears from Fleeting and (eventually, after the spaced-review schedule due date passes) shows up in Today's review
- Wait 10s — `ls ~/Notes/zettel/` (or whatever `$ZK_MIRROR_DIR`) should contain `.md` files matching the notes; `git -C ~/Notes/zettel log` should show commits

- [ ] **Step 4: Update `README.md`** — bump status and add the mirror script

Find the "Current status" section. Replace with:

```markdown
## Current status

M1 Plans 1–4 complete. The stack supports note + link + tag CRUD, a CodeMirror 6 markdown editor with `[[wikilink]]` autocomplete and decoration, a backlinks panel with note titles, inline tag editing, a ⌘K command palette over Postgres FTS, a Sigma.js graph view at `/graph`, a triage inbox at `/inbox` with spaced-repetition daily review and fleeting-note promotion, and a markdown mirror worker that writes every note to `~/Notes/zettel/` as a YAML-frontmatter `.md` file with git auto-commits.
```

Append to the "Setup" block:

```markdown
pnpm dev:mirror   # mirror worker — writes notes to ~/Notes/zettel and auto-commits
```

(Insert that line after `pnpm dev:web` in the existing code block.)

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update readme for M1 Plan 4 completion"
```

---

## Verification checklist (final, post-implementation)

- [ ] `pnpm test` passes (~116 tests).
- [ ] `pnpm -r typecheck` is clean.
- [ ] Manual inbox smoke: panes render; Promote/Keep/Archive actions update state.
- [ ] Manual mirror smoke: `pnpm dev:mirror` creates `~/Notes/zettel/<slug>-<id>.md` files and commits to git.
- [ ] LinksPanel renders titles via the slim batched fetch (Network tab shows `fields=id,title,type`).
- [ ] Two rapid clicks on different chip-removes don't drop a removal.

---

## What's deliberately NOT in this plan

- **Merge action** for "today's review" — the spec describes "merge into X" with a dialog; postpone to a polish pass after the daily-review habit forms
- **Stale topic notes pane** in /inbox — the spec mentions a fourth pane "stale topic notes that haven't been touched"; defer until a stale-detection heuristic is worked out
- **Hard delete** for notes — only soft-archive remains, consistent with prior plans
- **BullMQ for the mirror worker** — periodic sweep with setInterval is sufficient for personal scale; revisit if responsiveness becomes a problem
- **Force-mirror command** (`pnpm mirror:run`) — could add a one-shot script for manual sync; defer
- **Mirror exposes a /api/mirror/status endpoint** — defer; sync state is visible in mirror logs and git log
- **ML-driven daily review prompt** — M3 will replace the current `next_due_at` ladder with an embedding-distance-aware re-ranker

These are non-blocking, deliberate deferrals.
