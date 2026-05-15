# Graph, Search & Tags Implementation Plan (M1, Plan 3 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ILIKE search with proper Postgres full-text search (fixes ordering, case-sensitivity, and pattern-injection bugs in one move). Wire up a ⌘K command palette over that search. Render the auto-graph at `/graph` via Sigma.js. Add an inline tag editor in the note top bar. Front-load three Plan 2 carry-overs that touch surfaces this plan modifies anyway.

**Architecture:** A generated `tsv` tsvector column on the `note` table, indexed with GIN, powers both the autocomplete and ⌘K palette via the same `/api/notes/search` endpoint — now ranking by `ts_rank` and bypassing the ILIKE injection footgun. The wikilink resolver in `wikilinks-sync.ts` switches to a case-insensitive `lower(title) = lower(...)` match to align with FTS's case-insensitive behavior. A new `GET /api/graph` returns nodes + edges suitable for graphology; `apps/web/src/routes/graph.tsx` renders it with Sigma.js. The ⌘K palette is a single overlay component that reuses `api.searchNotes` and registers a global keyboard listener at the route-tree level.

**Tech Stack:** Postgres FTS (`to_tsvector`, `websearch_to_tsquery`, `ts_rank`, GIN), `graphology` (data structure), `sigma` + `@react-sigma/core` (renderer + React wrapper), TanStack Query for the palette debouncing.

---

## File Structure

```
apps/api/src/
├── db/
│   ├── schema.ts                                   (modify) — tsv generated column on notes
│   └── migrations/0002_notes_fts.sql               (generated + hand-augmented)
├── lib/
│   └── wikilinks-sync.ts                           (modify) — case-insensitive title match
└── routes/
    ├── notes.ts                                    (modify) — FTS search; ?ids= filter; skip-sync optimization
    └── graph.ts                                    (create) — GET /api/graph

apps/web/src/
├── routes/
│   ├── __root.tsx                                  (modify) — render command palette overlay
│   ├── notes.$noteId.tsx                           (modify) — wire TagEditor in NoteTopBar; fix editor stomp
│   └── graph.tsx                                   (create) — Sigma graph route
├── components/
│   ├── CommandPalette.tsx                          (create) — ⌘K overlay
│   ├── TagEditor.tsx                               (create) — chip-style add/remove
│   ├── NoteTopBar.tsx                              (modify) — hosts TagEditor
│   ├── LinksPanel.tsx                              (modify) — uses titles via batched fetch
│   └── NoteEditor.tsx                              (modify) — controlled-not-stomped pattern
└── lib/
    ├── api-client.ts                               (modify) — listNotesByIds, getGraph, setNoteTags
    └── use-command-palette.ts                      (create) — open/close state + ⌘K hotkey

packages/shared/src/
└── (no changes)
```

**Why this layout**

- Graph data is a new endpoint with its own concerns (traversal, payload shape), so it lives in `routes/graph.ts` rather than bloating `routes/notes.ts`.
- The ⌘K palette is two pieces: a `use-command-palette.ts` hook (state + key listener) and a `CommandPalette.tsx` component (visuals). Keeping them apart means the hook can be tested without mounting the modal.
- `TagEditor` is its own component because it'll grow (autocomplete from existing tag set, drag-reorder, etc.) and shouldn't pull NoteTopBar down with it.
- LinksPanel's title resolution piggybacks on the existing list endpoint extended with an `?ids=` filter — no separate batch endpoint needed.

---

## Conventions

- **Postgres on `localhost:5433`** (same as Plans 1 + 2).
- **All commands run from the repo root** unless otherwise noted.
- **TDD** — failing test, then implementation. Each task commits at the end.
- **noUncheckedIndexedAccess** is on; `!.` non-null assertions are the established pattern.
- **Error shape** is `{ error: string }` via the `zodErrorHook` plumbing from Plan 2.

---

## Task 1: NoteEditor — don't clobber unsaved local edits (Plan 2 carry-over)

The current `useEffect` in `apps/web/src/routes/notes.$noteId.tsx` resets the local `body` state whenever `noteQuery.data` changes — which happens on any background refetch (e.g., window focus). Mid-edit, the user's text vanishes.

**Files:**
- Modify: `apps/web/src/routes/notes.$noteId.tsx`

- [ ] **Step 1: Read the current `apps/web/src/routes/notes.$noteId.tsx`**

Locate the `useEffect` that initializes `title` and `body` from `noteQuery.data`. It currently runs on every data change.

- [ ] **Step 2: Replace the effect with a one-shot initializer keyed by note id**

Replace the existing block:

```ts
const [title, setTitle] = useState("");
const [body, setBody] = useState("");

useEffect(() => {
  if (noteQuery.data) {
    setTitle(noteQuery.data.title);
    setBody(noteQuery.data.body_md ?? "");
  }
}, [noteQuery.data]);
```

with:

```ts
const [title, setTitle] = useState("");
const [body, setBody] = useState("");
const [hydratedFor, setHydratedFor] = useState<string | null>(null);

useEffect(() => {
  if (noteQuery.data && hydratedFor !== noteQuery.data.id) {
    setTitle(noteQuery.data.title);
    setBody(noteQuery.data.body_md ?? "");
    setHydratedFor(noteQuery.data.id);
  }
}, [noteQuery.data, hydratedFor]);
```

Now the editor hydrates exactly once per note-id transition. Background refetches that return the same id are ignored. After save, `onSuccess` invalidates and refetches — the id matches `hydratedFor`, so the effect doesn't re-overwrite the user's text.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

- [ ] **Step 4: Run web tests**

Run: `pnpm --filter @zk/web test`
Expected: 9 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/notes.$noteId.tsx
git commit -m "fix(web): editor hydrates once per note-id, not every refetch"
```

---

## Task 2: Skip syncWikilinks on PATCH when body unchanged (Plan 2 carry-over)

A PATCH that only updates `title` (or `type`) shouldn't re-run wikilink sync. Two extra DB round-trips per title edit add up.

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/tests/notes.test.ts`

- [ ] **Step 1: Read the PATCH handler in `apps/api/src/routes/notes.ts`**

Find the block that calls `syncWikilinks(tx, id, row!.bodyMd)` inside `db.transaction`.

- [ ] **Step 2: Append a regression test to `apps/api/tests/notes.test.ts`** — inside `describe("wikilink sync on note write", ...)`

```ts
  it("does not re-run wikilink sync when only title changes", async () => {
    await post("/api/notes", { title: "T", type: "permanent" });
    const src = (await (
      await post("/api/notes", {
        title: "S",
        type: "permanent",
        body_md: "[[T]]"
      })
    ).json()) as { id: string; updated_at: string };

    // Manually mutate the wikilink row so we can see whether sync re-ran.
    await app.request(`/api/notes/${src.id}/links`); // baseline check
    const before = (await (
      await app.request(`/api/notes/${src.id}/links`)
    ).json()) as { outgoing: { id: string }[] };
    const linkIdBefore = before.outgoing[0]!.id;

    // PATCH only the title.
    await app.request(`/api/notes/${src.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": src.updated_at
      },
      body: JSON.stringify({ title: "S renamed" })
    });

    const after = (await (
      await app.request(`/api/notes/${src.id}/links`)
    ).json()) as { outgoing: { id: string }[] };
    // Same link id ⇒ no delete+reinsert happened.
    expect(after.outgoing[0]!.id).toBe(linkIdBefore);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @zk/api test notes`
Expected: FAIL — the current code re-runs sync, which deletes and reinserts the row, giving it a new id.

- [ ] **Step 4: Gate the sync call on whether `body_md` was provided**

In `apps/api/src/routes/notes.ts`, find the PATCH transaction block. Currently:

```ts
const updated = await db.transaction(async (tx) => {
  const [row] = await tx
    .update(notes)
    .set({...})
    .where(eq(notes.id, id))
    .returning();
  await syncWikilinks(tx, id, row!.bodyMd);
  return row!;
});
```

Replace with:

```ts
const updated = await db.transaction(async (tx) => {
  const [row] = await tx
    .update(notes)
    .set({...})
    .where(eq(notes.id, id))
    .returning();
  if (update.body_md !== undefined) {
    await syncWikilinks(tx, id, row!.bodyMd);
  }
  return row!;
});
```

(Keep the `.set({...})` content the same — only wrap the `syncWikilinks` call in the body_md check.)

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — the new test and all existing tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "perf(api): skip wikilink sync on PATCH when body unchanged"
```

---

## Task 3: Postgres FTS — generated tsvector column + GIN index

The current ILIKE search has three real bugs from the Plan 2 review: case-sensitivity mismatch with the wikilink resolver, ordering by recency rather than relevance, and `%`/`_` interpreted as LIKE patterns. Switching to Postgres FTS fixes all three in one change.

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/migrations/0002_notes_fts.sql` (generated + hand-augmented)

- [ ] **Step 1: Update `apps/api/src/db/schema.ts`** — add the tsvector column to the `notes` table

Read the current file. Add to the imports at the top (the existing import includes `pgTable, uuid, text, timestamp, pgEnum, uniqueIndex, index, primaryKey, check`):

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
  customType
} from "drizzle-orm/pg-core";
```

Above the `notes` table definition, declare a `tsvector` custom type so Drizzle treats the column as opaque (we never read it from app code; it's index-only):

```ts
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  }
});
```

Add a `tsv` column to the `notes` table columns object, between `notionPageId` and the table-extras callback. The column is **generated by the migration** (not by Drizzle's schema generator, because Drizzle's `generatedAlwaysAs` for tsvector is finicky); we declare it in the schema so SELECT * doesn't accidentally try to write to it:

```ts
    notionPageId: text("notion_page_id"),
    tsv: tsvector("tsv")
  },
  (t) => [
    uniqueIndex("note_notion_page_id_idx")
      .on(t.notionPageId)
      .where(sql`${t.notionPageId} IS NOT NULL`),
    index("note_type_idx").on(t.type),
    index("note_tsv_idx").using("gin", t.tsv),
    check(
      "note_topic_body_null",
      sql`(${t.type} <> 'topic') OR (${t.bodyMd} IS NULL)`
    )
  ]
);
```

(Note the added `index("note_tsv_idx").using("gin", t.tsv)` line and the `tsv` column.)

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @zk/api exec drizzle-kit generate --name=notes_fts`
Expected: a new `apps/api/src/db/migrations/0002_notes_fts.sql` file appears. It will declare the `tsv` column as plain `tsvector` and create the GIN index — but it won't make the column generated.

- [ ] **Step 3: Hand-augment the migration**

Open `apps/api/src/db/migrations/0002_notes_fts.sql`. Drizzle will have produced something like:

```sql
ALTER TABLE "note" ADD COLUMN "tsv" tsvector;
--> statement-breakpoint
CREATE INDEX "note_tsv_idx" ON "note" USING gin ("tsv");
```

Replace the entire file content with:

```sql
ALTER TABLE "note"
  ADD COLUMN "tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("body_md", '')), 'B')
  ) STORED;
--> statement-breakpoint
CREATE INDEX "note_tsv_idx" ON "note" USING gin ("tsv");
```

`setweight(... 'A')` on title means title matches outrank body matches at the same `ts_rank`. `'english'` is the text search configuration; Postgres ships with it.

Inspect the file to confirm it now matches the block above.

- [ ] **Step 4: Apply migration to both DBs**

```bash
pnpm --filter @zk/api db:migrate
NODE_ENV=test pnpm --filter @zk/api db:migrate
```

Both should print `Migrations complete.`

- [ ] **Step 5: Verify the column and index exist**

Run: `docker exec zk-postgres psql -U zk -d zettel -c "\d note"`
Expected output includes a `tsv` column of type `tsvector` (marked `generated always as ... stored`) and an index `note_tsv_idx` on `(tsv)` using `gin`.

- [ ] **Step 6: Run existing tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — all 56 prior tests still pass. The new column is generated, so existing INSERT/UPDATE statements (which don't mention `tsv`) work unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations
git commit -m "feat(api): generated tsvector column on notes for FTS"
```

---

## Task 4: Search endpoint uses FTS with ts_rank

Now that the column exists, swap the ILIKE search for a `websearch_to_tsquery` + `ts_rank` query.

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/tests/notes.test.ts`

- [ ] **Step 1: Append failing tests to `apps/api/tests/notes.test.ts`** — inside `describe("GET /api/notes/search", ...)`

```ts
  it("ranks title matches above body matches", async () => {
    await post("/api/notes", {
      title: "Foucault",
      type: "literature",
      body_md: "x"
    });
    await post("/api/notes", {
      title: "Other",
      type: "permanent",
      body_md: "Foucault appears in body only"
    });
    const res = await app.request("/api/notes/search?q=Foucault");
    const body = (await res.json()) as {
      notes: { title: string }[];
    };
    expect(body.notes[0]!.title).toBe("Foucault");
    expect(body.notes[1]!.title).toBe("Other");
  });

  it("handles percent and underscore as literals (no LIKE-pattern injection)", async () => {
    await post("/api/notes", { title: "100%", type: "fleeting" });
    await post("/api/notes", { title: "snake_case", type: "fleeting" });
    await post("/api/notes", { title: "unrelated", type: "fleeting" });

    const pct = await app.request("/api/notes/search?q=100%25");
    // %25 is "%" url-encoded; the search should treat the % as text, not a wildcard.
    const pctBody = (await pct.json()) as { notes: { title: string }[] };
    expect(pctBody.notes.map((n) => n.title)).toContain("100%");
    expect(pctBody.notes.find((n) => n.title === "unrelated")).toBeUndefined();
  });

  it("is case-insensitive", async () => {
    await post("/api/notes", { title: "MixedCase", type: "fleeting" });
    const res = await app.request("/api/notes/search?q=mixedcase");
    const body = (await res.json()) as { notes: { title: string }[] };
    expect(body.notes.map((n) => n.title)).toContain("MixedCase");
  });
```

- [ ] **Step 2: Run tests to verify the title-rank test fails**

Run: `pnpm --filter @zk/api test notes`
Expected: FAIL on the new title-rank case (current code orders by `updatedAt`). The case-insensitive case may already pass because ILIKE is case-insensitive; the pattern-injection case may fail.

- [ ] **Step 3: Replace the search route in `apps/api/src/routes/notes.ts`**

Find the existing `notesRoute.get("/search", ...)` handler. Replace its body with an FTS-ranked query.

Update the `drizzle-orm` import to include `sql`:

```ts
import { and, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
```

(Note: `ilike` may now be unused — leave it for now; Task 5 may still use it elsewhere. If TypeScript flags the unused import, remove it.)

Replace the handler:

```ts
notesRoute.get("/search", zValidator("query", SearchQuerySchema, zodErrorHook), async (c) => {
  const { q } = c.req.valid("query");
  const tsQuery = sql`websearch_to_tsquery('english', ${q})`;
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      type: notes.type,
      rank: sql<number>`ts_rank(${notes.tsv}, ${tsQuery})`.as("rank")
    })
    .from(notes)
    .where(
      and(sql`${notes.tsv} @@ ${tsQuery}`, isNull(notes.archivedAt))
    )
    .orderBy(sql`rank DESC`, desc(notes.updatedAt))
    .limit(10);
  return c.json({ notes: rows.map(({ rank, ...rest }) => rest) });
});
```

The result rows shed the `rank` field before serialization — it was only needed for sorting.

`websearch_to_tsquery` is the user-friendly query parser (handles plain words, AND/OR/NOT, quoted phrases). It treats `%` and `_` as ordinary text.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — the three new search tests green; the five prior search tests still pass (the FTS query handles the same shapes).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): FTS-ranked search via websearch_to_tsquery and ts_rank"
```

---

## Task 5: Case-insensitive wikilink resolution

The wikilink resolver in `syncWikilinks` does an exact `inArray(notes.title, [...])` match, while the search is now (and was) case-insensitive. Users typing `[[foucault]]` see Foucault in the autocomplete but get a non-resolving wikilink on save.

**Files:**
- Modify: `apps/api/src/lib/wikilinks-sync.ts`
- Modify: `apps/api/tests/wikilinks-sync.test.ts`

- [ ] **Step 1: Append failing tests to `apps/api/tests/wikilinks-sync.test.ts`** — inside `describe("syncWikilinks", ...)`

```ts
  it("resolves wikilinks case-insensitively", async () => {
    const a = await createNote("A");
    const target = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Foucault" })
      .returning({ id: schema.notes.id });
    const targetId = target[0]!.id;

    await syncWikilinks(db, a, "see [[foucault]]");

    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toHaveLength(1);
    expect(links[0]!.toNoteId).toBe(targetId);
  });

  it("picks the newest match deterministically on ambiguous titles", async () => {
    const a = await createNote("A");
    const older = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Dup" })
      .returning({ id: schema.notes.id });
    // Force the second insert to have a strictly later createdAt.
    await new Promise((r) => setTimeout(r, 5));
    const newer = await db
      .insert(schema.notes)
      .values({ type: "permanent", title: "Dup" })
      .returning({ id: schema.notes.id });

    await syncWikilinks(db, a, "[[Dup]]");

    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toHaveLength(1);
    expect(links[0]!.toNoteId).toBe(newer[0]!.id);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test wikilinks-sync`
Expected: FAIL — the case-insensitive test fails (case-sensitive `inArray` doesn't match `foucault`), and the ambiguous-title test is order-undefined.

- [ ] **Step 3: Update `apps/api/src/lib/wikilinks-sync.ts`** — switch to `lower(title)` matching + deterministic newest-first

Read the current file. Find the matches query:

```ts
const matches =
  distinctTitles.length === 0
    ? []
    : await db
        .select({ id: notes.id, title: notes.title })
        .from(notes)
        .where(
          and(inArray(notes.title, distinctTitles), isNull(notes.archivedAt))
        );
```

Add `sql` and `desc` to the existing `drizzle-orm` imports if not already present:

```ts
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
```

Replace the matches query with:

```ts
const lowerTitles = distinctTitles.map((t) => t.toLowerCase());
const matches =
  lowerTitles.length === 0
    ? []
    : await db
        .select({ id: notes.id, title: notes.title })
        .from(notes)
        .where(
          and(
            sql`lower(${notes.title}) IN ${sql.raw(`(${lowerTitles.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")})`)}`,
            isNull(notes.archivedAt)
          )
        )
        .orderBy(desc(notes.createdAt));
```

Wait — that's brittle (the `sql.raw` SQL-injection-prone). Use a safer approach: introduce a parameter array. Drizzle's `sql` template supports arrays via `sql.placeholder` or by inlining. The cleanest is to use `inArray` on a lowered expression. Drizzle 0.36 supports `sql\`lower(${notes.title})\`` as a column expression. Replace with:

```ts
const lowerTitles = distinctTitles.map((t) => t.toLowerCase());
const matches =
  lowerTitles.length === 0
    ? []
    : await db
        .select({ id: notes.id, title: notes.title })
        .from(notes)
        .where(
          and(
            inArray(sql<string>`lower(${notes.title})`, lowerTitles),
            isNull(notes.archivedAt)
          )
        )
        .orderBy(desc(notes.createdAt));
```

This is safe (parameterized via `inArray`) and case-insensitive. The `desc(notes.createdAt)` ordering makes "newest match wins" deterministic.

Next, update the title-to-id mapping. The keys must also be lowercase, since `wikilinks` carries the original-case titles:

```ts
const titleToId = new Map<string, string>();
for (const m of matches) {
  const key = m.title.toLowerCase();
  if (!titleToId.has(key)) titleToId.set(key, m.id);
}

const desiredTargets = new Set<string>();
for (const title of distinctTitles) {
  const id = titleToId.get(title.toLowerCase());
  if (id && id !== fromNoteId) desiredTargets.add(id);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — new case-insensitive and ambiguous-title tests green; all 9 prior wikilinks-sync tests still pass; full API suite still green.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): case-insensitive wikilink resolution with deterministic tiebreak"
```

---

## Task 6: Search endpoint returns recent notes on empty query

The autocomplete dropdown should show *something* when the user types `[[` and pauses — currently the explicit-trigger code sends a single literal space, which matches almost nothing. Make `q` optional; when absent or whitespace-only, return the 10 most recent non-archived notes.

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/tests/notes.test.ts`
- Modify: `apps/web/src/lib/cm-wikilinks.ts`

- [ ] **Step 1: Append a failing test to `apps/api/tests/notes.test.ts`** — inside `describe("GET /api/notes/search", ...)`

```ts
  it("returns recent notes when q is empty", async () => {
    await post("/api/notes", { title: "Old", type: "fleeting" });
    await new Promise((r) => setTimeout(r, 5));
    await post("/api/notes", { title: "New", type: "fleeting" });
    const res = await app.request("/api/notes/search?q=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: { title: string }[] };
    expect(body.notes.map((n) => n.title)).toEqual(["New", "Old"]);
  });
```

(Also delete the older `"returns 400 on missing q"` test — that behavior is changing. Search for it and remove it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zk/api test notes`
Expected: FAIL — the current schema rejects empty `q`, returning 400.

- [ ] **Step 3: Relax the search schema and handler in `apps/api/src/routes/notes.ts`**

Find:

```ts
const SearchQuerySchema = z.object({ q: z.string().min(1) });
```

Replace with:

```ts
const SearchQuerySchema = z.object({ q: z.string().default("") });
```

Update the handler. After validating `q`, branch: if `q.trim().length === 0`, run a plain recency query; otherwise the FTS path:

```ts
notesRoute.get("/search", zValidator("query", SearchQuerySchema, zodErrorHook), async (c) => {
  const { q } = c.req.valid("query");
  const trimmed = q.trim();

  if (trimmed.length === 0) {
    const rows = await db
      .select({ id: notes.id, title: notes.title, type: notes.type })
      .from(notes)
      .where(isNull(notes.archivedAt))
      .orderBy(desc(notes.updatedAt))
      .limit(10);
    return c.json({ notes: rows });
  }

  const tsQuery = sql`websearch_to_tsquery('english', ${trimmed})`;
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      type: notes.type,
      rank: sql<number>`ts_rank(${notes.tsv}, ${tsQuery})`.as("rank")
    })
    .from(notes)
    .where(
      and(sql`${notes.tsv} @@ ${tsQuery}`, isNull(notes.archivedAt))
    )
    .orderBy(sql`rank DESC`, desc(notes.updatedAt))
    .limit(10);
  return c.json({ notes: rows.map(({ rank, ...rest }) => rest) });
});
```

- [ ] **Step 4: Update `apps/web/src/lib/cm-wikilinks.ts`** — drop the single-space sentinel

Find:

```ts
const { notes } = await searchFn(q.length > 0 ? q : " ");
```

Replace with:

```ts
const { notes } = await searchFn(q);
```

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: PASS — both API and web tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api apps/web
git commit -m "feat(api): search returns recent notes when q is empty"
```

---

## Task 7: List endpoint accepts `?ids=` filter (batched fetch)

To resolve note titles for backlinks in `LinksPanel`, the web app needs to fetch many notes by id in one round-trip. Extend `GET /api/notes` with an `ids` comma-separated query parameter.

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/tests/notes.test.ts`
- Modify: `apps/web/src/lib/api-client.ts`

- [ ] **Step 1: Append failing tests to `apps/api/tests/notes.test.ts`** — inside `describe("GET /api/notes", ...)`

```ts
  it("filters by ids when ?ids= is provided", async () => {
    const a = (await (
      await post("/api/notes", { title: "A", type: "permanent" })
    ).json()) as { id: string };
    const b = (await (
      await post("/api/notes", { title: "B", type: "permanent" })
    ).json()) as { id: string };
    await post("/api/notes", { title: "C", type: "permanent" });

    const res = await app.request(`/api/notes?ids=${a.id},${b.id}`);
    const body = (await res.json()) as { notes: { id: string }[] };
    const ids = body.notes.map((n) => n.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("returns empty array when ?ids= is empty", async () => {
    await post("/api/notes", { title: "X", type: "fleeting" });
    const res = await app.request("/api/notes?ids=");
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test notes`
Expected: FAIL — `ids` is ignored today.

- [ ] **Step 3: Extend the list schema and handler in `apps/api/src/routes/notes.ts`**

Find:

```ts
const ListQuerySchema = z.object({
  type: NoteType.optional(),
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
  include_archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
});
```

Update the handler. The current list handler builds `where = and(typeFilter, archivedFilter)`. Add an ids filter:

```ts
notesRoute.get("/", zValidator("query", ListQuerySchema, zodErrorHook), async (c) => {
  const { type, ids, include_archived } = c.req.valid("query");
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
  const where = and(
    type ? eq(notes.type, type) : undefined,
    include_archived ? undefined : isNull(notes.archivedAt)
  );
  const rows = await db
    .select()
    .from(notes)
    .where(where)
    .orderBy(desc(notes.createdAt));
  const tagsByNote = await fetchTagsFor(rows.map((r) => r.id));
  return c.json({
    notes: rows.map((r) => serializeNote(r, tagsByNote.get(r.id) ?? []))
  });
});
```

Note that `?ids=...` bypasses the `type` and `include_archived` filters — when you explicitly request specific ids, you want them regardless of type or archive state.

- [ ] **Step 4: Extend `apps/web/src/lib/api-client.ts`** — add `listNotesByIds`

Read the file. Add after `listNotes`:

```ts
listNotesByIds(ids: string[]): Promise<{ notes: Note[] }> {
  if (ids.length === 0) return Promise.resolve({ notes: [] });
  return request(
    `/api/notes?ids=${ids.map(encodeURIComponent).join(",")}`,
    { method: "GET" }
  );
},
```

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: PASS — new tests green; everything else still green.

- [ ] **Step 6: Commit**

```bash
git add apps/api apps/web
git commit -m "feat(api): batched note fetch via ?ids= query param"
```

---

## Task 8: LinksPanel shows titles instead of truncated ids

Now that the batched fetch is available, replace the `8 char...` placeholders in the right rail with actual note titles.

**Files:**
- Modify: `apps/web/src/components/LinksPanel.tsx`

- [ ] **Step 1: Read the current `apps/web/src/components/LinksPanel.tsx`**

Identify the two `<Link>` elements that render `{l.to_note_id.slice(0, 8)}…` and `{l.from_note_id.slice(0, 8)}…`.

- [ ] **Step 2: Replace the file content**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { api } from "../lib/api-client";
import type { NoteLink } from "@zk/shared";

interface LinksPanelProps {
  noteId: string;
}

function groupByType(links: NoteLink[]): Map<string, NoteLink[]> {
  const groups = new Map<string, NoteLink[]>();
  for (const l of links) {
    const existing = groups.get(l.link_type);
    if (existing) existing.push(l);
    else groups.set(l.link_type, [l]);
  }
  return groups;
}

export function LinksPanel({ noteId }: LinksPanelProps) {
  const linksQuery = useQuery({
    queryKey: ["notes", noteId, "links"],
    queryFn: () => api.getNoteLinks(noteId)
  });

  const allReferencedIds = useMemo(() => {
    if (!linksQuery.data) return [];
    const ids = new Set<string>();
    for (const l of linksQuery.data.outgoing) ids.add(l.to_note_id);
    for (const l of linksQuery.data.incoming) ids.add(l.from_note_id);
    return [...ids];
  }, [linksQuery.data]);

  const titlesQuery = useQuery({
    queryKey: ["notes", "titles", allReferencedIds],
    queryFn: () => api.listNotesByIds(allReferencedIds),
    enabled: allReferencedIds.length > 0
  });

  const titleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of titlesQuery.data?.notes ?? []) map.set(n.id, n.title);
    return map;
  }, [titlesQuery.data]);

  if (linksQuery.isLoading) {
    return (
      <div className="links-panel">
        <p style={{ color: "#666" }}>Loading…</p>
      </div>
    );
  }
  if (linksQuery.isError || !linksQuery.data) {
    return (
      <div className="links-panel">
        <p style={{ color: "#f7768e" }}>Failed to load links.</p>
      </div>
    );
  }

  const outgoing = groupByType(linksQuery.data.outgoing);
  const incoming = groupByType(linksQuery.data.incoming);

  const labelFor = (id: string) => titleById.get(id) ?? `${id.slice(0, 8)}…`;

  return (
    <div className="links-panel">
      <div className="links-panel-group">
        <h4>Outgoing</h4>
        {outgoing.size === 0 ? (
          <p className="links-panel-empty">No outgoing links.</p>
        ) : (
          [...outgoing.entries()].map(([type, links]) => (
            <div key={type} style={{ marginBottom: 6 }}>
              <span style={{ color: "#888", fontSize: 11 }}>{type}</span>
              <ul style={{ margin: "2px 0" }}>
                {links.map((l) => (
                  <li key={l.id}>
                    <Link to="/notes/$noteId" params={{ noteId: l.to_note_id }}>
                      {labelFor(l.to_note_id)}
                    </Link>
                    {l.context && (
                      <span style={{ color: "#666", fontSize: 11 }}>
                        {" "}— {l.context}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="links-panel-group">
        <h4>Backlinks</h4>
        {incoming.size === 0 ? (
          <p className="links-panel-empty">No backlinks.</p>
        ) : (
          [...incoming.entries()].map(([type, links]) => (
            <div key={type} style={{ marginBottom: 6 }}>
              <span style={{ color: "#888", fontSize: 11 }}>{type}</span>
              <ul style={{ margin: "2px 0" }}>
                {links.map((l) => (
                  <li key={l.id}>
                    <Link to="/notes/$noteId" params={{ noteId: l.from_note_id }}>
                      {labelFor(l.from_note_id)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

- [ ] **Step 4: Run web tests**

Run: `pnpm --filter @zk/web test`
Expected: 9 prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/LinksPanel.tsx
git commit -m "feat(web): LinksPanel shows note titles via batched fetch"
```

---

## Task 9: API tag suggestions endpoint

The tag editor (Task 10) calls a suggestions endpoint as the user types. Returns up to 10 tags ranked by usage count.

**Files:**
- Modify: `apps/api/src/routes/tags.ts`
- Modify: `apps/api/tests/tags.test.ts`

- [ ] **Step 1: Append failing tests to `apps/api/tests/tags.test.ts`** — at the bottom of the file

```ts
describe("GET /api/tags/suggest", () => {
  it("returns tags matching prefix, ordered by count desc", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const note = (await (
        await post("/api/notes", { title: `n${i}`, type: "permanent" })
      ).json()) as { id: string };
      ids.push(note.id);
    }
    // 'method' tagged on 2 notes, 'machine' on 1, 'unrelated' on 1
    await app.request(`/api/notes/${ids[0]!}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["method", "unrelated"] })
    });
    await app.request(`/api/notes/${ids[1]!}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["method"] })
    });
    await app.request(`/api/notes/${ids[2]!}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["machine"] })
    });

    const res = await app.request("/api/tags/suggest?q=m");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: { name: string }[] };
    expect(body.tags.map((t) => t.name)).toEqual(["method", "machine"]);
  });

  it("returns all tags when q is empty", async () => {
    const id = (await (
      await post("/api/notes", { title: "n", type: "permanent" })
    ).json()) as { id: string };
    await app.request(`/api/notes/${id.id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["a", "b"] })
    });
    const res = await app.request("/api/tags/suggest?q=");
    const body = (await res.json()) as { tags: { name: string }[] };
    expect(body.tags.map((t) => t.name).sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test tags`
Expected: FAIL — `/api/tags/suggest` doesn't exist.

- [ ] **Step 3: Add the suggest endpoint in `apps/api/src/routes/tags.ts`**

Read the current file. Add `desc` and `ilike` to the existing `drizzle-orm` import:

```ts
import { desc, eq, ilike, inArray, sql } from "drizzle-orm";
```

(The current file imports `eq, inArray, sql`. Add `desc` and `ilike`.)

Add to imports at top (or augment existing):

```ts
import { z } from "zod";
import { zodErrorHook } from "../lib/zod-error-hook";
```

(`zodErrorHook` should already be imported from Plan 2 carry-over Task 1; verify.)

Add this route handler to `tagsRoute` after the existing `GET /`:

```ts
const SuggestQuerySchema = z.object({ q: z.string().default("") });

tagsRoute.get("/suggest", zValidator("query", SuggestQuerySchema, zodErrorHook), async (c) => {
  const { q } = c.req.valid("query");
  const trimmed = q.trim();
  const rows = await db
    .select({
      name: tags.name,
      count: sql<number>`count(${noteTags.tagId})::int`.as("count")
    })
    .from(tags)
    .leftJoin(noteTags, eq(noteTags.tagId, tags.id))
    .where(trimmed.length > 0 ? ilike(tags.name, `${trimmed}%`) : undefined)
    .groupBy(tags.id, tags.name)
    .orderBy(sql`count DESC`, tags.name)
    .limit(10);
  return c.json({ tags: rows });
});
```

(LIKE-pattern injection in the tag name is much less of a concern than in user free-text search because tag names are constrained to kebab-case, but using `ilike(tags.name, ${trimmed}%)` with a bound parameter still parameterizes the value safely.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — both new tests green; all 6 prior tag tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): tag suggestions endpoint with usage-count ranking"
```

---

## Task 10: Web — TagEditor component + setNoteTags client method

A chip-style editor: existing tags rendered as removable chips, an input that suggests as you type, Enter or click on a suggestion adds the tag.

**Files:**
- Create: `apps/web/src/components/TagEditor.tsx`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Extend `apps/web/src/lib/api-client.ts`** — add `setNoteTags` and `suggestTags`

Add new methods to the `api` object:

```ts
setNoteTags(noteId: string, tagNames: string[]): Promise<{ tags: string[] }> {
  return request(`/api/notes/${noteId}/tags`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tags: tagNames })
  });
},

suggestTags(q: string): Promise<{ tags: { name: string; count: number }[] }> {
  const qs = new URLSearchParams({ q }).toString();
  return request(`/api/tags/suggest?${qs}`, { method: "GET" });
}
```

- [ ] **Step 2: Append to `apps/web/src/styles.css`**

```css

.tag-editor {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.tag-editor .tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tag-editor .tag-chip-remove {
  cursor: pointer;
  border: 0;
  background: transparent;
  color: #888;
  padding: 0 0 0 2px;
  font-size: 12px;
}

.tag-editor-input {
  background: transparent;
  border: 0;
  outline: 0;
  padding: 2px 4px;
  font-size: 12px;
  min-width: 80px;
  color: inherit;
}

.tag-editor-suggest {
  position: absolute;
  margin-top: 2px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  font-size: 12px;
  z-index: 10;
  min-width: 140px;
}

.tag-editor-suggest button {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 4px 8px;
  color: inherit;
}

.tag-editor-suggest button:hover {
  background: #222;
}
```

- [ ] **Step 3: Create `apps/web/src/components/TagEditor.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../lib/api-client";

interface TagEditorProps {
  noteId: string;
  tags: string[];
}

const KEBAB_RE = /^[a-z0-9][a-z0-9-]*$/;

export function TagEditor({ noteId, tags }: TagEditorProps) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const suggestQuery = useQuery({
    queryKey: ["tags", "suggest", input],
    queryFn: () => api.suggestTags(input),
    enabled: showSuggest
  });

  const setTagsMutation = useMutation({
    mutationFn: (next: string[]) => api.setNoteTags(noteId, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", noteId] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  const addTag = (name: string) => {
    const cleaned = name.trim().toLowerCase();
    if (!cleaned || !KEBAB_RE.test(cleaned)) return;
    if (tags.includes(cleaned)) {
      setInput("");
      return;
    }
    setTagsMutation.mutate([...tags, cleaned]);
    setInput("");
  };

  const removeTag = (name: string) => {
    setTagsMutation.mutate(tags.filter((t) => t !== name));
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]!);
    } else if (e.key === "Escape") {
      setShowSuggest(false);
    }
  };

  return (
    <div className="tag-editor" ref={wrapperRef}>
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          {t}
          <button
            type="button"
            className="tag-chip-remove"
            onClick={() => removeTag(t)}
            aria-label={`Remove tag ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <div style={{ position: "relative" }}>
        <input
          className="tag-editor-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggest(true);
          }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => setTimeout(() => setShowSuggest(false), 100)}
          onKeyDown={onKeyDown}
          placeholder={tags.length === 0 ? "add tag…" : ""}
          disabled={setTagsMutation.isPending}
        />
        {showSuggest && (suggestQuery.data?.tags.length ?? 0) > 0 && (
          <div className="tag-editor-suggest">
            {suggestQuery.data!.tags
              .filter((t) => !tags.includes(t.name))
              .slice(0, 6)
              .map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(t.name);
                  }}
                >
                  {t.name}{" "}
                  <span style={{ color: "#666" }}>×{t.count}</span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

The `onMouseDown` (instead of `onClick`) on the suggestion button matters: `onClick` would fire after the input loses focus and the blur handler hides the dropdown.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/TagEditor.tsx apps/web/src/lib/api-client.ts apps/web/src/styles.css
git commit -m "feat(web): TagEditor component with suggestions"
```

---

## Task 11: Wire TagEditor into NoteTopBar

Replace the read-only tag chips with the editable TagEditor.

**Files:**
- Modify: `apps/web/src/components/NoteTopBar.tsx`

- [ ] **Step 1: Replace `apps/web/src/components/NoteTopBar.tsx`**

```tsx
import type { Note } from "@zk/shared";
import { TagEditor } from "./TagEditor";

interface NoteTopBarProps {
  note: Note;
  onBack: () => void;
}

export function NoteTopBar({ note, onBack }: NoteTopBarProps) {
  return (
    <div className="note-top-bar">
      <button onClick={onBack}>← Back</button>
      <span className="note-type-chip">{note.type}</span>
      <TagEditor noteId={note.id} tags={note.tags} />
      <span style={{ marginLeft: "auto", color: "#888" }}>
        updated {new Date(note.updated_at).toLocaleString()}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

- [ ] **Step 3: Web tests**

Run: `pnpm --filter @zk/web test`
Expected: 9 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/NoteTopBar.tsx
git commit -m "feat(web): wire TagEditor into NoteTopBar"
```

---

## Task 12: ⌘K command palette

Global overlay triggered by Cmd-K (or Ctrl-K). Reuses the existing FTS search. Arrow keys navigate, Enter opens, Escape closes.

**Files:**
- Create: `apps/web/src/lib/use-command-palette.ts`
- Create: `apps/web/src/components/CommandPalette.tsx`
- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Create `apps/web/src/lib/use-command-palette.ts`**

```ts
import { useEffect, useState } from "react";

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}
```

- [ ] **Step 2: Append to `apps/web/src/styles.css`**

```css

.cmdp-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 100;
}

.cmdp {
  width: 560px;
  max-width: 90vw;
  background: #161616;
  border: 1px solid #333;
  border-radius: 6px;
  overflow: hidden;
}

.cmdp input {
  width: 100%;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 14px 16px;
  font-size: 15px;
  color: inherit;
  border-bottom: 1px solid #222;
}

.cmdp-result {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  border: 0;
  background: transparent;
  width: 100%;
  text-align: left;
  color: inherit;
  font: inherit;
}

.cmdp-result-active {
  background: #222;
}

.cmdp-result-type {
  font-size: 11px;
  text-transform: uppercase;
  color: #888;
}

.cmdp-empty {
  padding: 14px 16px;
  color: #666;
  font-size: 13px;
}
```

- [ ] **Step 3: Create `apps/web/src/components/CommandPalette.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (open) {
      setQ("");
      setHighlight(0);
    }
  }, [open]);

  const resultsQuery = useQuery({
    queryKey: ["palette-search", q],
    queryFn: () => api.searchNotes(q),
    enabled: open
  });

  const results = resultsQuery.data?.notes ?? [];

  const handleKey: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[highlight];
      if (picked) {
        onClose();
        navigate({ to: "/notes/$noteId", params: { noteId: picked.id } });
      }
    }
  };

  if (!open) return null;

  return (
    <div className="cmdp-backdrop" onClick={onClose}>
      <div className="cmdp" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={handleKey}
          placeholder="Search notes…"
        />
        {results.length === 0 ? (
          <div className="cmdp-empty">
            {resultsQuery.isLoading ? "Searching…" : "No matches."}
          </div>
        ) : (
          results.map((n, i) => (
            <button
              key={n.id}
              type="button"
              className={`cmdp-result ${
                i === highlight ? "cmdp-result-active" : ""
              }`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                onClose();
                navigate({
                  to: "/notes/$noteId",
                  params: { noteId: n.id }
                });
              }}
            >
              <span>{n.title}</span>
              <span className="cmdp-result-type">{n.type}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the palette into `apps/web/src/routes/__root.tsx`**

Read the file. Replace its content with:

```tsx
import { Outlet, createRootRoute, Link } from "@tanstack/react-router";
import { CommandPalette } from "../components/CommandPalette";
import { useCommandPalette } from "../lib/use-command-palette";

function Root() {
  const { open, setOpen } = useCommandPalette();
  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
            Zettelkasten
          </Link>
          <span style={{ marginLeft: 8, fontSize: 12, color: "#666" }}>
            ⌘K to search
          </span>
        </h1>
      </header>
      <Outlet />
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export const Route = createRootRoute({ component: Root });
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

- [ ] **Step 6: Web tests**

Run: `pnpm --filter @zk/web test`
Expected: 9 prior tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): ⌘K command palette over FTS search"
```

---

## Task 13: API — graph data endpoint

`GET /api/graph` returns `{ nodes: [...], edges: [...] }` shaped for graphology. Includes only non-archived notes.

**Files:**
- Create: `apps/api/src/routes/graph.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/tests/graph.test.ts`

- [ ] **Step 1: Write failing test `apps/api/tests/graph.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { app } from "../src/server";

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("GET /api/graph", () => {
  it("returns nodes for non-archived notes and edges for note_links", async () => {
    const a = (await (
      await post("/api/notes", { title: "A", type: "permanent" })
    ).json()) as { id: string };
    const b = (await (
      await post("/api/notes", { title: "B", type: "permanent" })
    ).json()) as { id: string };
    await post("/api/links", {
      from_note_id: a.id,
      to_note_id: b.id,
      link_type: "supports"
    });

    const res = await app.request("/api/graph");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: { id: string; title: string; type: string }[];
      edges: {
        id: string;
        source: string;
        target: string;
        link_type: string;
      }[];
    };
    expect(body.nodes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0]!.source).toBe(a.id);
    expect(body.edges[0]!.target).toBe(b.id);
    expect(body.edges[0]!.link_type).toBe("supports");
  });

  it("excludes archived notes from nodes and dangling edges", async () => {
    const a = (await (
      await post("/api/notes", { title: "A", type: "permanent" })
    ).json()) as { id: string };
    const b = (await (
      await post("/api/notes", { title: "B", type: "permanent" })
    ).json()) as { id: string };
    await post("/api/links", { from_note_id: a.id, to_note_id: b.id });
    await app.request(`/api/notes/${b.id}`, { method: "DELETE" });

    const res = await app.request("/api/graph");
    const body = (await res.json()) as {
      nodes: { id: string }[];
      edges: unknown[];
    };
    expect(body.nodes.map((n) => n.id)).toEqual([a.id]);
    expect(body.edges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test graph`
Expected: FAIL — `/api/graph` doesn't exist.

- [ ] **Step 3: Create `apps/api/src/routes/graph.ts`**

```ts
import { Hono } from "hono";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notes, noteLinks } from "../db/schema";

export const graphRoute = new Hono();

graphRoute.get("/", async (c) => {
  const nodeRows = await db
    .select({
      id: notes.id,
      title: notes.title,
      type: notes.type
    })
    .from(notes)
    .where(isNull(notes.archivedAt));

  const aliveIds = new Set(nodeRows.map((n) => n.id));

  const edgeRows = await db
    .select({
      id: noteLinks.id,
      source: noteLinks.fromNoteId,
      target: noteLinks.toNoteId,
      link_type: noteLinks.linkType
    })
    .from(noteLinks);

  const edges = edgeRows.filter(
    (e) => aliveIds.has(e.source) && aliveIds.has(e.target)
  );

  return c.json({ nodes: nodeRows, edges });
});
```

(We compute edges in JS rather than via a JOIN that filters both endpoints because Postgres can't express "edge IFF both endpoints exist in this filtered set" elegantly. For a personal-scale graph this is fine — even with 10K notes and 100K links it's milliseconds.)

- [ ] **Step 4: Mount the route in `apps/api/src/server.ts`**

Read the current file. Add to imports:

```ts
import { graphRoute } from "./routes/graph";
```

And add an `app.route` line near the existing route mounts (after `app.route("/api/notes", noteTagsRoute);`):

```ts
app.route("/api/graph", graphRoute);
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — 2 graph tests green; all prior tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): graph data endpoint"
```

---

## Task 14: Web — install Sigma.js + graphology

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-workspace.yaml` if any new deps need allowBuilds approval

- [ ] **Step 1: Add the graph deps to `apps/web/package.json`**

Add these to the `dependencies` section in alphabetical position:

```json
"@react-sigma/core": "^4.0.3",
"graphology": "^0.25.4",
"graphology-layout-force": "^0.2.4",
"sigma": "^3.0.0-beta.18",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
If pnpm complains about build scripts (`sigma` or graph utilities may have native deps), add to `allowBuilds:` in `pnpm-workspace.yaml` and re-install.

- [ ] **Step 3: Verify the install**

Run: `pnpm --filter @zk/web exec node -e "import('@react-sigma/core').then(() => console.log('ok'))"`
Expected: prints `ok`.

- [ ] **Step 4: Add `getGraph` to the API client at `apps/web/src/lib/api-client.ts`**

Add a new method to the `api` object:

```ts
getGraph(): Promise<{
  nodes: { id: string; title: string; type: string }[];
  edges: { id: string; source: string; target: string; link_type: string }[];
}> {
  return request("/api/graph", { method: "GET" });
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml pnpm-workspace.yaml apps/web/src/lib/api-client.ts
git commit -m "chore(web): add sigma.js + graphology deps, getGraph client method"
```

---

## Task 15: Web — `/graph` route with Sigma renderer

**Files:**
- Create: `apps/web/src/routes/graph.tsx`
- Modify: `apps/web/src/routes/__root.tsx` — add a "Graph" nav link

- [ ] **Step 1: Create `apps/web/src/routes/graph.tsx`**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { SigmaContainer, useLoadGraph, useRegisterEvents } from "@react-sigma/core";
import Graph from "graphology";
import "@react-sigma/core/lib/style.css";
import { api } from "../lib/api-client";

export const Route = createFileRoute("/graph")({
  component: GraphPage
});

const TYPE_COLORS: Record<string, string> = {
  fleeting: "#888888",
  literature: "#9ece6a",
  permanent: "#7aa2f7",
  topic: "#bb9af7"
};

interface GraphData {
  nodes: { id: string; title: string; type: string }[];
  edges: { id: string; source: string; target: string; link_type: string }[];
}

function GraphLoader({
  data,
  typeFilter
}: {
  data: GraphData;
  typeFilter: string | null;
}) {
  const loadGraph = useLoadGraph();
  useEffect(() => {
    const graph = new Graph({ multi: true });
    const includedNodes = new Set<string>();
    for (const n of data.nodes) {
      if (typeFilter && n.type !== typeFilter) continue;
      includedNodes.add(n.id);
      graph.addNode(n.id, {
        label: n.title,
        size: 4,
        color: TYPE_COLORS[n.type] ?? "#cccccc",
        x: Math.random(),
        y: Math.random()
      });
    }
    for (const e of data.edges) {
      if (!includedNodes.has(e.source) || !includedNodes.has(e.target)) continue;
      try {
        graph.addEdgeWithKey(e.id, e.source, e.target, {
          color: "#444",
          size: 1
        });
      } catch {
        // Duplicate-key insert: ignore; a previous render may already have added it.
      }
    }
    loadGraph(graph);
  }, [data, typeFilter, loadGraph]);
  return null;
}

function GraphEvents({ onNodeClick }: { onNodeClick: (id: string) => void }) {
  const registerEvents = useRegisterEvents();
  useEffect(() => {
    registerEvents({
      clickNode: (e) => onNodeClick(e.node)
    });
  }, [registerEvents, onNodeClick]);
  return null;
}

function GraphPage() {
  const navigate = useNavigate();
  const graphQuery = useQuery({
    queryKey: ["graph"],
    queryFn: () => api.getGraph()
  });
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const types = useMemo(() => {
    if (!graphQuery.data) return [];
    return [...new Set(graphQuery.data.nodes.map((n) => n.type))].sort();
  }, [graphQuery.data]);

  if (graphQuery.isLoading) return <p>Loading graph…</p>;
  if (graphQuery.isError || !graphQuery.data)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load graph: {String(graphQuery.error)}
      </p>
    );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          onClick={() => setTypeFilter(null)}
          style={{
            background: typeFilter === null ? "#333" : "#1a1a1a"
          }}
        >
          all ({graphQuery.data.nodes.length})
        </button>
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            style={{
              background: typeFilter === t ? "#333" : "#1a1a1a",
              color: TYPE_COLORS[t] ?? "inherit"
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ height: "70vh", border: "1px solid #222", borderRadius: 4 }}>
        <SigmaContainer
          style={{ height: "100%", background: "#0f0f0f" }}
          settings={{
            renderLabels: true,
            labelColor: { color: "#e8e8e8" },
            labelSize: 11,
            defaultEdgeColor: "#444",
            defaultNodeColor: "#cccccc"
          }}
        >
          <GraphLoader data={graphQuery.data} typeFilter={typeFilter} />
          <GraphEvents
            onNodeClick={(id) =>
              navigate({ to: "/notes/$noteId", params: { noteId: id } })
            }
          />
        </SigmaContainer>
      </div>
    </div>
  );
}
```

The random initial coordinates are intentional — Sigma needs *some* layout to render; we leave force-layout polish to a later iteration. Even random scatter is informative enough to navigate the graph by clicking nodes.

- [ ] **Step 2: Add a "Graph" link to `apps/web/src/routes/__root.tsx`**

In the `Root` component you wrote in Task 12, add a nav link next to the title. Replace the `<header>` JSX with:

```tsx
<header style={{ marginBottom: 24, display: "flex", alignItems: "baseline", gap: 16 }}>
  <h1 style={{ margin: 0 }}>
    <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
      Zettelkasten
    </Link>
  </h1>
  <Link to="/graph" style={{ fontSize: 14, color: "#7aa2f7" }}>
    Graph
  </Link>
  <span style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>
    ⌘K to search
  </span>
</header>
```

- [ ] **Step 3: Regenerate the route tree**

Briefly run `pnpm --filter @zk/web dev` (a few seconds, then kill). The TanStack Router plugin should detect `routes/graph.tsx` and update `routeTree.gen.ts`.

Alternative: invoke the route generator directly if your `@tanstack/router-plugin` install exposes a binary; running `dev` and stopping it after the routeTree update is the simplest path.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean. If the `<Link to="/graph">` typecheck fails, the route tree wasn't regenerated — repeat Step 3.

- [ ] **Step 5: Web tests**

Run: `pnpm --filter @zk/web test`
Expected: 9 tests still pass (no new tests; Sigma rendering in jsdom is not reliable enough to test there).

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): /graph route with sigma renderer and type filters"
```

---

## Task 16: End-to-end verification + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full workspace test suite**

Run: `pnpm test`
Expected: all packages green. Approximate counts:
- `@zk/shared`: 22 (unchanged from Plan 2)
- `@zk/api`: 56 baseline + 3 FTS + 1 empty-q + 2 ids + 2 case-insensitive + 1 perf-skip + 2 graph + 2 tag suggest ≈ 69 total
- `@zk/web`: 9 (unchanged)

Total approximately ~100 tests.

- [ ] **Step 2: Workspace typecheck**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke (skip if foreground servers are inconvenient — tests + typecheck cover correctness)**

Bring up the stack:

```bash
pnpm db:up
pnpm dev:api    # terminal 1
pnpm dev:web    # terminal 2
```

In the browser at `http://localhost:5173`:
- Create a few notes (mix of `permanent` and `topic`)
- Add a wikilink in one body, confirm autocomplete + correct title ordering
- Add tags via the chip editor in the top bar; remove one; confirm persistence
- Hit ⌘K and search; arrow keys + Enter should navigate
- Click "Graph" — see nodes colored by type, click a node, land on the detail page

Stop the dev servers.

- [ ] **Step 4: Update `README.md`**

Find the "Current status" section. Replace with:

```markdown
## Current status

M1 Plans 1–3 complete. The stack supports note + link + tag CRUD, a CodeMirror 6 markdown editor with `[[wikilink]]` autocomplete and decoration, a right-rail backlinks panel with note titles, inline tag editing in the top bar, a ⌘K command palette over Postgres FTS, and a Sigma.js graph view at `/graph` with type filters. Wikilinks auto-sync into the `note_link` table on save.
```

- [ ] **Step 5: Commit the README update**

```bash
git add README.md
git commit -m "docs: update readme for M1 Plan 3 completion"
```

---

## Verification checklist (final, post-implementation)

- [ ] `pnpm test` passes (~100 tests).
- [ ] `pnpm -r typecheck` is clean.
- [ ] Manual editor smoke: typing `[[<title>]]` (any case) creates a `note_link` row.
- [ ] Manual ⌘K smoke: Cmd-K opens palette; typing filters by relevance; Enter navigates.
- [ ] Manual graph smoke: `/graph` renders nodes colored by type; clicking a node navigates.
- [ ] Manual tag smoke: chip editor adds and removes tags; suggestions appear when typing.
- [ ] Manual FTS smoke: searching for a term that appears in the body (not the title) returns the note.

---

## What's deliberately NOT in this plan

- Stable graph layout (force-directed run on load) — random initial positions are fine for navigation; full layout polish is a polish pass after we've used the graph for a few weeks
- Edge color/styling by `link_type` — currently all edges are gray
- Filtering the graph by tag or by date range — only `type` filter ships
- ⌘K integration with non-note targets (jumping to graph, to topics, etc.) — only note search
- Tag editor with drag-reorder, max-count, or merging
- Search highlighting (showing which part of a note matched) — Plan 4 or later
- Hover-peek for wikilinks in the editor — deferred from Plan 2 still
- Cmd-click on wikilinks in the editor to navigate — same
- Tag-driven graph clustering or filtering

These are non-blocking, deliberate deferrals.
