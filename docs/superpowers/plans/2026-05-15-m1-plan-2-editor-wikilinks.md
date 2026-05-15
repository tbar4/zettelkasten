# Note Editor + Wikilinks Implementation Plan (M1, Plan 2 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the textarea in the note detail page with a CodeMirror 6 markdown editor that supports `[[wikilink]]` autocomplete, syntax decoration, hover-peek, and cmd+click navigation. Auto-sync wikilinks into the `note_link` table on save. Add a right-rail panel showing backlinks + outbound links grouped by `link_type`, and a top bar with the note's type, tags, and last-edited timestamp. Front-load the four Plan 1 final-review carry-overs as the first tasks.

**Architecture:** A shared wikilink parser in `packages/shared` is consumed by both the API (during writes, to derive `note_link` rows) and the web app (during editing, to highlight wikilinks). The `note_link` table gains a `source` enum column (`'wikilink' | 'manual'`) so wikilink sync only touches the rows it owns. The editor uses raw CodeMirror 6 via `@uiw/react-codemirror`, with a custom extension stack for wikilink decorations and autocomplete that hits a new `GET /api/notes/search` endpoint.

**Tech Stack:** CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/lang-markdown`, `@codemirror/autocomplete`, `@codemirror/view`, `@codemirror/state`), Drizzle migration for `note_link.source`, Hono + Zod-validator error hook for uniform error shape, Postgres error codes via `postgres` driver's `PostgresError`.

---

## File Structure

```
apps/api/src/
├── routes/
│   ├── notes.ts                                (modify) — search endpoint, tags on response, link sync hook
│   └── links.ts                                (modify) — code-based error matching
├── lib/
│   ├── errors.ts                               (modify) — onError handles zod errors uniformly
│   ├── zod-error-hook.ts                       (create) — shared zValidator hook
│   └── wikilinks-sync.ts                       (create) — diff & apply wikilink → note_link
├── db/
│   ├── schema.ts                               (modify) — add source column on note_link
│   └── migrations/0001_wikilink_source.sql     (generated)
└── tests/
    ├── errors.test.ts                          (create) — uniform error shape
    ├── notes.test.ts                           (modify) — tags in response, search endpoint, nullable body
    └── wikilinks.test.ts                       (create) — sync diff behavior

apps/web/src/
├── routes/
│   └── notes.$noteId.tsx                       (modify) — wire NoteEditor, LinksPanel, NoteTopBar
├── components/
│   ├── NoteEditor.tsx                          (create) — CodeMirror wrapper with extensions
│   ├── LinksPanel.tsx                          (create) — backlinks + outbound right rail
│   └── NoteTopBar.tsx                          (create) — type chip, tags, last-edited
├── lib/
│   ├── api-client.ts                           (modify) — searchNotes, getLinks, getNoteTags
│   └── cm-wikilinks.ts                         (create) — CodeMirror extension factory
└── styles.css                                  (modify) — wikilink, links-panel, top-bar classes

packages/shared/src/
├── wikilinks.ts                                (create) — parse + extract wikilinks from markdown
├── note.ts                                     (modify) — add tags + nullable body_md to NoteSchema/UpdateNoteSchema
├── link.ts                                     (modify) — add LinkSource enum
└── index.ts                                    (modify) — re-export
```

**Why this layout**

- The wikilink parser lives in `packages/shared` because both the editor (to highlight `[[...]]`) and the API (to extract them at save time) use the exact same regex. Drift would cause edits and persisted links to diverge.
- CodeMirror extensions live in `apps/web/src/lib/cm-wikilinks.ts` separately from the React wrapper in `components/NoteEditor.tsx`. That split lets the wrapper stay thin and reusable; the extensions can be tested as a unit later.
- `LinksPanel` and `NoteTopBar` are their own components because they each have a distinct responsibility and grow over later plans (link types, tag editing, "open canvas" button when M2 lands).
- The Zod-validator error hook is its own file so every route file gets uniform error shapes without each having to remember to pass the hook.

---

## Conventions

- **Postgres on `localhost:5433`** (same as Plan 1).
- **All commands run from the repo root** unless otherwise noted.
- **TDD** — failing test, then implementation. Each task commits at the end.
- **Tests** — Vitest. The shared `tests/setup.ts` in `apps/api` truncates tables between tests.
- **Conventional Commits** for messages (`feat:`, `fix:`, `chore:`, `test:`).

---

## Task 1: Uniform error shape (Plan 1 carry-over)

The `@hono/zod-validator` returns `{ success: false, error: { issues: [...] } }` on bad input, bypassing the `onError` handler. Hand-crafted errors return `{ error: "..." }`. The web client `request()` only knows how to read `body.error` as a string. Fix: install a hook on `zValidator` that throws `HTTPException(400, { message: <formatted issues> })`, so everything flows through `onError`.

**Files:**
- Create: `apps/api/src/lib/zod-error-hook.ts`
- Modify: `apps/api/src/routes/notes.ts` — pass the hook
- Modify: `apps/api/src/routes/links.ts` — pass the hook
- Modify: `apps/api/src/routes/tags.ts` — pass the hook
- Create: `apps/api/tests/errors.test.ts`

- [ ] **Step 1: Write failing test `apps/api/tests/errors.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { app } from "../src/server";

describe("error shape consistency", () => {
  it("zod validation failure returns {error: string}", async () => {
    const res = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "", type: "permanent" })
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
    expect((body.error as string).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("success");
    expect(body).not.toHaveProperty("issues");
  });

  it("handcrafted 404 returns {error: string}", async () => {
    const res = await app.request(
      "/api/notes/550e8400-e29b-41d4-a716-446655440099"
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("zod failure on topic-with-body returns 400 with string error", async () => {
    const res = await app.request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "T", type: "topic", body_md: "no" })
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/topic notes must not have body_md/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zk/api test errors`
Expected: FAIL — current zod-validator returns `{ success: false, error: {...} }`.

- [ ] **Step 3: Create `apps/api/src/lib/zod-error-hook.ts`**

```ts
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError, type ZodIssue } from "zod";

function formatIssues(issues: ZodIssue[]): string {
  return issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") + ": " : "";
      return `${path}${i.message}`;
    })
    .join("; ");
}

export function zodErrorHook(
  result: { success: true } | { success: false; error: ZodError },
  _c: Context
) {
  if (!result.success) {
    throw new HTTPException(400, {
      message: formatIssues(result.error.issues)
    });
  }
}
```

- [ ] **Step 4: Wire the hook into every `zValidator` call in `apps/api/src/routes/notes.ts`**

Add to imports at the top of the file:

```ts
import { zodErrorHook } from "../lib/zod-error-hook";
```

Then change every `zValidator("json", X)` and `zValidator("param", X)` and `zValidator("query", X)` call to pass the hook as a third argument. For example:

```ts
notesRoute.post("/", zValidator("json", NewNoteSchema, zodErrorHook), async (c) => { ... });

notesRoute.get("/", zValidator("query", ListQuerySchema, zodErrorHook), async (c) => { ... });

notesRoute.get("/:id", zValidator("param", idParam, zodErrorHook), async (c) => { ... });

notesRoute.patch(
  "/:id",
  zValidator("param", idParam, zodErrorHook),
  zValidator("json", UpdateNoteSchema, zodErrorHook),
  async (c) => { ... }
);

notesRoute.delete("/:id", zValidator("param", idParam, zodErrorHook), async (c) => { ... });
```

Read the current file first, then update each `zValidator(...)` call. The function body stays the same.

- [ ] **Step 5: Wire the hook into every `zValidator` call in `apps/api/src/routes/links.ts`**

Same pattern. Add import:

```ts
import { zodErrorHook } from "../lib/zod-error-hook";
```

Then update each `zValidator(...)` call to pass `zodErrorHook` as the third argument.

- [ ] **Step 6: Wire the hook into every `zValidator` call in `apps/api/src/routes/tags.ts`**

Same pattern. Add import and update each `zValidator(...)` call.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — all error tests green, all 33 prior tests still pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "fix(api): uniform error shape across zod and handcrafted errors"
```

---

## Task 2: Postgres error codes (Plan 1 carry-over)

`apps/api/src/routes/links.ts` catches DB errors via substring matching on `err.message`. The `postgres` driver attaches `code` (SQLSTATE) and `constraint_name` as first-class properties. Switch to those.

**Files:**
- Modify: `apps/api/src/routes/links.ts`

- [ ] **Step 1: Read the current `apps/api/src/routes/links.ts`**

Identify the `catch (err)` block in the `linksRoute.post("/")` handler.

- [ ] **Step 2: Replace the substring-matching catch block**

Find this block (it follows the `.returning()` await):

```ts
} catch (err) {
  if (
    err instanceof Error &&
    err.message.includes("note_link_unique")
  ) {
    throw conflict("link already exists for that pair and type");
  }
  if (
    err instanceof Error &&
    err.message.includes("note_link_not_self")
  ) {
    throw badRequest("from and to must differ");
  }
  throw err;
}
```

Replace it with:

```ts
} catch (err) {
  const pgErr = err as { code?: string; constraint_name?: string };
  // 23505 = unique_violation, 23514 = check_violation (SQLSTATE)
  if (pgErr.code === "23505" && pgErr.constraint_name === "note_link_unique") {
    throw conflict("link already exists for that pair and type");
  }
  if (
    pgErr.code === "23514" &&
    pgErr.constraint_name === "note_link_not_self"
  ) {
    throw badRequest("from and to must differ");
  }
  throw err;
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @zk/api test links`
Expected: PASS — the 9 link tests still green. The duplicate-link 409 and self-link 400 tests now route through SQLSTATE codes rather than substring matching.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "fix(api): match Postgres SQLSTATE codes instead of message substrings"
```

---

## Task 3: PATCH type-conversion guard + nullable body_md (Plan 1 carry-overs)

Two related issues:
- A PATCH that changes `type: "permanent" → "topic"` while keeping the existing body_md should return 400, not 500. The current guard only checks the *pre-update* type.
- `UpdateNoteSchema` has `body_md: z.string().optional()` — no way to send `body_md: null` to clear the body when a user converts to topic.

**Files:**
- Modify: `packages/shared/src/note.ts` — allow `body_md` to be nullable in NewNoteSchema and UpdateNoteSchema
- Modify: `apps/api/src/routes/notes.ts` — post-update guard checks effective (type, body_md) pair
- Modify: `packages/shared/tests/note.test.ts` — assert nullable behavior
- Modify: `apps/api/tests/notes.test.ts` — assert PATCH type-conversion behavior

- [ ] **Step 1: Update `packages/shared/src/note.ts`**

Replace the `NoteBase` object to accept `body_md: z.string().nullable().optional()` so both `null` and `undefined` are valid wire shapes. Read the file first, then apply this single replacement:

Old:
```ts
const NoteBase = z.object({
  title: z.string().min(1),
  type: NoteType,
  body_md: z.string().optional()
});
```

New:
```ts
const NoteBase = z.object({
  title: z.string().min(1),
  type: NoteType,
  body_md: z.string().nullable().optional()
});
```

The two `superRefine` checks already test `data.body_md !== undefined`. Change both to also reject non-null:

Old (in NewNoteSchema and UpdateNoteSchema both):
```ts
if (data.type === "topic" && data.body_md !== undefined) {
```

New:
```ts
if (data.type === "topic" && data.body_md !== undefined && data.body_md !== null) {
```

(So `body_md: null` on a topic note is allowed — it's how you explicitly say "this topic has no body".)

- [ ] **Step 2: Update tests in `packages/shared/tests/note.test.ts`**

Add these test cases inside the existing `describe("NewNoteSchema", ...)`:

```ts
  it("allows body_md: null on a topic note", () => {
    const parsed = NewNoteSchema.parse({
      title: "Topic",
      type: "topic",
      body_md: null
    });
    expect(parsed.body_md).toBeNull();
  });

  it("rejects a non-null body_md on a topic note", () => {
    expect(() =>
      NewNoteSchema.parse({
        title: "Topic",
        type: "topic",
        body_md: "still forbidden"
      })
    ).toThrow();
  });

  it("allows body_md: null on a permanent note (explicit clear)", () => {
    const parsed = NewNoteSchema.parse({
      title: "Perm",
      type: "permanent",
      body_md: null
    });
    expect(parsed.body_md).toBeNull();
  });
```

- [ ] **Step 3: Run shared tests**

Run: `pnpm --filter @zk/shared test`
Expected: PASS — old tests still green, three new tests green.

- [ ] **Step 4: Replace the post-update guard in `apps/api/src/routes/notes.ts`**

Locate the `notesRoute.patch("/:id", ...)` handler. Find this block:

```ts
if (existing.type === "topic" && update.body_md !== undefined) {
  throw badRequest("topic notes cannot have body_md");
}

const [updated] = await db
  .update(notes)
  .set({
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.type !== undefined ? { type: update.type } : {}),
    ...(update.body_md !== undefined ? { bodyMd: update.body_md } : {}),
    updatedAt: new Date()
  })
  ...
```

Replace it with:

```ts
// Compute effective post-update state and reject any (type=topic, body_md non-null) combination.
const effectiveType = update.type ?? existing.type;
const effectiveBodyMd =
  update.body_md !== undefined ? update.body_md : existing.bodyMd;
if (effectiveType === "topic" && effectiveBodyMd !== null) {
  throw badRequest(
    "topic notes cannot have body_md; send body_md: null when converting"
  );
}

const [updated] = await db
  .update(notes)
  .set({
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.type !== undefined ? { type: update.type } : {}),
    ...(update.body_md !== undefined ? { bodyMd: update.body_md } : {}),
    updatedAt: new Date()
  })
  ...
```

This computes the effective state (post-update) and validates that combination. Now any of these transitions returns 400 cleanly:
- type → topic while existing body_md is non-null and update doesn't clear it
- body_md → "text" while existing or updated type is topic

- [ ] **Step 5: Append failing tests to `apps/api/tests/notes.test.ts`** — add inside the existing `describe("PATCH /api/notes/:id", ...)` block

```ts
  it("rejects type permanent → topic with existing body (no body clear)", async () => {
    const created = (await (
      await post("/api/notes", {
        title: "P",
        type: "permanent",
        body_md: "stays around"
      })
    ).json()) as { id: string; updated_at: string };

    const res = await patch(
      `/api/notes/${created.id}`,
      { type: "topic" },
      { "if-match": created.updated_at }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/body_md: null/);
  });

  it("allows type permanent → topic when body is cleared to null in same request", async () => {
    const created = (await (
      await post("/api/notes", {
        title: "P",
        type: "permanent",
        body_md: "will go away"
      })
    ).json()) as { id: string; updated_at: string };

    const res = await patch(
      `/api/notes/${created.id}`,
      { type: "topic", body_md: null },
      { "if-match": created.updated_at }
    );
    expect(res.status).toBe(200);
    const note = (await res.json()) as { type: string; body_md: string | null };
    expect(note.type).toBe("topic");
    expect(note.body_md).toBeNull();
  });
```

- [ ] **Step 6: Run API tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — all previous + the two new PATCH tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/shared
git commit -m "fix: nullable body_md and effective-state guard on PATCH"
```

---

## Task 4: Add `source` column to `note_link`

The wikilink auto-sync (Task 9) only touches `note_link` rows where `source = 'wikilink'`. Rows added via `POST /api/links` get `source = 'manual'` and are never automatically deleted.

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/routes/links.ts` — POST inserts `source: 'manual'`
- Modify: `packages/shared/src/link.ts` — `LinkSource` enum + exposed on `NoteLinkSchema`
- Generated: `apps/api/src/db/migrations/0001_link_source.sql`

- [ ] **Step 1: Update `apps/api/src/db/schema.ts`** — add the `linkSourceEnum` and the `source` column on `noteLinks`

Add after the `linkTypeEnum` declaration:

```ts
export const linkSourceEnum = pgEnum("link_source", ["wikilink", "manual"]);
```

Then inside the `noteLinks` column object, add a `source` column after `context`:

```ts
context: text("context"),
source: linkSourceEnum("source").notNull().default("manual"),
createdAt: timestamp("created_at", { withTimezone: true })
  .defaultNow()
  .notNull()
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @zk/api exec drizzle-kit generate --name=link_source`
Expected: a new file appears at `apps/api/src/db/migrations/0001_link_source.sql`. Inspect it briefly — should `CREATE TYPE link_source` and `ALTER TABLE note_link ADD COLUMN source link_source NOT NULL DEFAULT 'manual'`.

- [ ] **Step 3: Apply migration to both DBs**

```bash
pnpm --filter @zk/api db:migrate
NODE_ENV=test pnpm --filter @zk/api db:migrate
```

Both should print `Migrations complete.`.

- [ ] **Step 4: Update `packages/shared/src/link.ts`** — expose `LinkSource`

Add after the `LinkType` declaration:

```ts
export const LinkSource = z.enum(["wikilink", "manual"]);
export type LinkSource = z.infer<typeof LinkSource>;
```

Then modify `NoteLinkSchema` to include `source`:

Old:
```ts
export const NoteLinkSchema = z.object({
  id: z.string().uuid(),
  from_note_id: z.string().uuid(),
  to_note_id: z.string().uuid(),
  link_type: LinkType,
  context: z.string().nullable(),
  created_at: z.string().datetime()
});
```

New:
```ts
export const NoteLinkSchema = z.object({
  id: z.string().uuid(),
  from_note_id: z.string().uuid(),
  to_note_id: z.string().uuid(),
  link_type: LinkType,
  context: z.string().nullable(),
  source: LinkSource,
  created_at: z.string().datetime()
});
```

- [ ] **Step 5: Update `apps/api/src/routes/links.ts`** — POST inserts with explicit `source: "manual"`, GET returns `source` field

Find the `db.insert(noteLinks).values({...})` in the POST handler. Add `source: "manual"`:

```ts
const [created] = await db
  .insert(noteLinks)
  .values({
    fromNoteId: input.from_note_id,
    toNoteId: input.to_note_id,
    linkType: input.link_type,
    context: input.context ?? null,
    source: "manual"
  })
  .returning();
```

Then update `serializeLink` to include `source`:

```ts
function serializeLink(row: typeof noteLinks.$inferSelect) {
  return {
    id: row.id,
    from_note_id: row.fromNoteId,
    to_note_id: row.toNoteId,
    link_type: row.linkType,
    context: row.context,
    source: row.source,
    created_at: row.createdAt.toISOString()
  };
}
```

- [ ] **Step 6: Re-export `LinkSource` from `packages/shared/src/index.ts`**

Verify `export * from "./link"` is already there. If yes, no change needed. If not, add it.

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @zk/shared test
pnpm --filter @zk/api test
```

Expected: PASS — link tests now have `source` in the JSON responses. If any old test asserted exact-object equality on a link response, it now expects `source: "manual"`. The current link tests do destructured property access (e.g., `link.link_type`), so they should be unaffected.

- [ ] **Step 8: Commit**

```bash
git add apps/api packages/shared
git commit -m "feat(api): add source column to note_link (wikilink|manual)"
```

---

## Task 5: Shared wikilink parser

A single regex-and-extraction module that both API and web consume.

**Files:**
- Create: `packages/shared/src/wikilinks.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/tests/wikilinks.test.ts`

- [ ] **Step 1: Write failing test `packages/shared/tests/wikilinks.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { extractWikilinks, WIKILINK_REGEX } from "../src/wikilinks";

describe("extractWikilinks", () => {
  it("returns empty for text with no wikilinks", () => {
    expect(extractWikilinks("just text")).toEqual([]);
    expect(extractWikilinks("")).toEqual([]);
  });

  it("extracts a single wikilink", () => {
    expect(extractWikilinks("see [[Other Note]] here")).toEqual([
      { title: "Other Note", start: 4, end: 18 }
    ]);
  });

  it("extracts multiple wikilinks", () => {
    const text = "[[A]] then [[B]] then [[C]]";
    const result = extractWikilinks(text);
    expect(result.map((w) => w.title)).toEqual(["A", "B", "C"]);
  });

  it("deduplicates by title for the unique-title use case", () => {
    const text = "[[A]] and again [[A]]";
    const titles = Array.from(new Set(extractWikilinks(text).map((w) => w.title)));
    expect(titles).toEqual(["A"]);
  });

  it("ignores escaped brackets", () => {
    // For Plan 2 we don't support escaping; just confirm we don't crash on edge input.
    expect(extractWikilinks("\\[[NotALink]]")).toEqual([
      { title: "NotALink", start: 2, end: 14 }
    ]);
  });

  it("ignores empty wikilinks", () => {
    expect(extractWikilinks("[[]]")).toEqual([]);
  });

  it("trims whitespace in titles", () => {
    expect(extractWikilinks("[[  Title  ]]")).toEqual([
      { title: "Title", start: 0, end: 13 }
    ]);
  });

  it("regex captures the title group", () => {
    const m = "before [[Foo Bar]] after".match(WIKILINK_REGEX);
    expect(m?.[1]).toBe("Foo Bar");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zk/shared test wikilinks`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/shared/src/wikilinks.ts`**

```ts
export interface Wikilink {
  title: string;
  start: number;
  end: number;
}

export const WIKILINK_REGEX = /\[\[([^\[\]\n]+?)\]\]/g;

export function extractWikilinks(text: string): Wikilink[] {
  const results: Wikilink[] = [];
  const re = new RegExp(WIKILINK_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const inner = match[1];
    if (inner === undefined) continue;
    const title = inner.trim();
    if (title.length === 0) continue;
    results.push({
      title,
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return results;
}
```

- [ ] **Step 4: Re-export from `packages/shared/src/index.ts`**

Add (if not present):

```ts
export * from "./wikilinks";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @zk/shared test`
Expected: PASS — all wikilink tests green; prior tests still green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): wikilink parser shared between api and web"
```

---

## Task 6: API search endpoint for autocomplete

`GET /api/notes/search?q=foo` returns up to 10 non-archived notes whose title contains `q` (case-insensitive), ordered by best-match. Used by the editor's `[[` autocomplete.

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/tests/notes.test.ts`

- [ ] **Step 1: Append failing tests to `apps/api/tests/notes.test.ts`** — add a new describe block

```ts
describe("GET /api/notes/search", () => {
  it("returns matching notes by title (case-insensitive)", async () => {
    await post("/api/notes", { title: "Foucault: Discipline", type: "literature" });
    await post("/api/notes", { title: "Foucault: Power", type: "literature" });
    await post("/api/notes", { title: "Other thing", type: "permanent" });

    const res = await app.request("/api/notes/search?q=foucault");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notes: { id: string; title: string; type: string }[];
    };
    expect(body.notes).toHaveLength(2);
    expect(body.notes.every((n) => n.title.includes("Foucault"))).toBe(true);
  });

  it("returns empty array when nothing matches", async () => {
    await post("/api/notes", { title: "Hello", type: "permanent" });
    const res = await app.request("/api/notes/search?q=zzzzz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toEqual([]);
  });

  it("returns 400 on missing q", async () => {
    const res = await app.request("/api/notes/search");
    expect(res.status).toBe(400);
  });

  it("excludes archived notes", async () => {
    const created = (await (
      await post("/api/notes", { title: "Visible", type: "permanent" })
    ).json()) as { id: string };
    await app.request(`/api/notes/${created.id}`, { method: "DELETE" });

    const res = await app.request("/api/notes/search?q=visible");
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toEqual([]);
  });

  it("limits results to 10", async () => {
    for (let i = 0; i < 15; i++) {
      await post("/api/notes", { title: `Note ${i}`, type: "fleeting" });
    }
    const res = await app.request("/api/notes/search?q=note");
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test notes`
Expected: FAIL on the new cases.

- [ ] **Step 3: Add the search route to `apps/api/src/routes/notes.ts`**

First, update the imports at the top of the file. The current imports have `and, desc, eq, isNull` from `drizzle-orm`; add `ilike`:

```ts
import { and, desc, eq, ilike, isNull } from "drizzle-orm";
```

Then add this route handler. Place it **before** `notesRoute.get("/:id", ...)` because Hono routes match in registration order and `/search` must match before the catch-all `:id`. The search handler:

```ts
const SearchQuerySchema = z.object({ q: z.string().min(1) });

notesRoute.get("/search", zValidator("query", SearchQuerySchema, zodErrorHook), async (c) => {
  const { q } = c.req.valid("query");
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      type: notes.type
    })
    .from(notes)
    .where(and(ilike(notes.title, `%${q}%`), isNull(notes.archivedAt)))
    .orderBy(desc(notes.updatedAt))
    .limit(10);
  return c.json({ notes: rows });
});
```

(Note: `q` is interpolated into the LIKE pattern. Drizzle parameterizes this — no SQL-injection risk because the value is a bound parameter, not string-concatenated SQL.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — search tests green; all other tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): note search endpoint for wikilink autocomplete"
```

---

## Task 7: Include tags on Note responses

The top bar needs to show tags. Currently `GET /api/notes/:id` doesn't include them. Easiest fix: compute tags in `serializeNote` and include them in every note response.

**Files:**
- Modify: `packages/shared/src/note.ts` — add `tags: string[]` to `NoteSchema`
- Modify: `apps/api/src/routes/notes.ts` — compute tags in list + read + create + update responses
- Modify: `apps/api/tests/notes.test.ts` — assert tags appear

- [ ] **Step 1: Update `packages/shared/src/note.ts`** — add `tags` to `NoteSchema`

Old:
```ts
export const NoteSchema = z.object({
  id: z.string().uuid(),
  type: NoteType,
  title: z.string(),
  body_md: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  archived_at: z.string().datetime().nullable(),
  notion_page_id: z.string().nullable()
});
```

New:
```ts
export const NoteSchema = z.object({
  id: z.string().uuid(),
  type: NoteType,
  title: z.string(),
  body_md: z.string().nullable(),
  tags: z.array(z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  archived_at: z.string().datetime().nullable(),
  notion_page_id: z.string().nullable()
});
```

- [ ] **Step 2: Update `apps/api/src/routes/notes.ts`** — compute tags per note

Update the imports at the top to add `inArray`:

```ts
import { and, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
```

And import the join tables:

```ts
import { notes, noteTags, tags } from "../db/schema";
```

(`noteTags` and `tags` are already exported from `db/schema.ts`.)

Replace `serializeNote` with a version that accepts a tag-map argument, and add a helper `fetchTagsFor(ids)`:

```ts
async function fetchTagsFor(noteIds: string[]): Promise<Map<string, string[]>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db
    .select({ noteId: noteTags.noteId, name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(inArray(noteTags.noteId, noteIds));
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const existing = map.get(r.noteId);
    if (existing) existing.push(r.name);
    else map.set(r.noteId, [r.name]);
  }
  return map;
}

function serializeNote(
  row: typeof notes.$inferSelect,
  tagNames: string[] = []
) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body_md: row.bodyMd,
    tags: tagNames.sort(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    archived_at: row.archivedAt?.toISOString() ?? null,
    notion_page_id: row.notionPageId
  };
}
```

Now update each handler that calls `serializeNote`:

For the list handler (`notesRoute.get("/")`):

```ts
notesRoute.get("/", zValidator("query", ListQuerySchema, zodErrorHook), async (c) => {
  const { type, include_archived } = c.req.valid("query");
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

For the create handler (`notesRoute.post("/")`):

```ts
notesRoute.post("/", zValidator("json", NewNoteSchema, zodErrorHook), async (c) => {
  const input = c.req.valid("json");
  const [created] = await db
    .insert(notes)
    .values({
      type: input.type,
      title: input.title,
      bodyMd: input.body_md ?? null
    })
    .returning();
  return c.json(serializeNote(created, []), 201);  // freshly created — no tags yet
});
```

For the single-read handler (`notesRoute.get("/:id")`):

```ts
notesRoute.get("/:id", zValidator("param", idParam, zodErrorHook), async (c) => {
  const { id } = c.req.valid("param");
  const [row] = await db.select().from(notes).where(eq(notes.id, id));
  if (!row) throw notFound("note", id);
  const tagsByNote = await fetchTagsFor([id]);
  return c.json(serializeNote(row, tagsByNote.get(id) ?? []));
});
```

For the PATCH handler (`notesRoute.patch("/:id")`), update the final return to include tags:

```ts
const tagsByNote = await fetchTagsFor([id]);
return c.json(serializeNote(updated, tagsByNote.get(id) ?? []));
```

- [ ] **Step 3: Append failing tests to `apps/api/tests/notes.test.ts`** — inside the existing `describe("GET /api/notes/:id", ...)` block

```ts
  it("includes tags in the response", async () => {
    const created = (await (
      await post("/api/notes", { title: "Tagged", type: "permanent" })
    ).json()) as { id: string };

    await app.request(`/api/notes/${created.id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["alpha", "beta"] })
    });

    const res = await app.request(`/api/notes/${created.id}`);
    const note = (await res.json()) as { tags: string[] };
    expect(note.tags.sort()).toEqual(["alpha", "beta"]);
  });
```

And inside `describe("GET /api/notes", ...)`:

```ts
  it("includes tags on each note in list", async () => {
    const created = (await (
      await post("/api/notes", { title: "A", type: "permanent" })
    ).json()) as { id: string };
    await app.request(`/api/notes/${created.id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: ["x"] })
    });

    const res = await app.request("/api/notes");
    const body = (await res.json()) as { notes: { tags: string[] }[] };
    expect(body.notes[0]!.tags).toEqual(["x"]);
  });
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — new tag-inclusion tests green; all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/shared
git commit -m "feat(api): include tags on note responses"
```

---

## Task 8: Wikilink sync helper

The API hook that derives `note_link` rows from a note's body_md text.

**Files:**
- Create: `apps/api/src/lib/wikilinks-sync.ts`
- Create: `apps/api/tests/wikilinks-sync.test.ts`

- [ ] **Step 1: Write failing test `apps/api/tests/wikilinks-sync.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { syncWikilinks } from "../src/lib/wikilinks-sync";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function createNote(title: string): Promise<string> {
  const [row] = await db
    .insert(schema.notes)
    .values({ type: "permanent", title })
    .returning({ id: schema.notes.id });
  return row!.id;
}

describe("syncWikilinks", () => {
  it("creates wikilink rows for resolved [[title]] mentions", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    await db
      .update(schema.notes)
      .set({ bodyMd: "See [[B]] for more" })
      .where(eq(schema.notes.id, a));

    await syncWikilinks(db, a, "See [[B]] for more");

    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toHaveLength(1);
    expect(links[0]!.toNoteId).toBe(b);
    expect(links[0]!.linkType).toBe("references");
    expect(links[0]!.source).toBe("wikilink");
  });

  it("removes wikilink rows when the wikilink is deleted from body", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    await syncWikilinks(db, a, "See [[B]]");
    expect(
      (await db.select().from(schema.noteLinks).where(eq(schema.noteLinks.fromNoteId, a)))
        .length
    ).toBe(1);

    await syncWikilinks(db, a, "no more links");

    const after = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(after).toEqual([]);
  });

  it("never touches manual links", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    await db.insert(schema.noteLinks).values({
      fromNoteId: a,
      toNoteId: b,
      linkType: "supports",
      source: "manual"
    });

    await syncWikilinks(db, a, "no wikilinks here");

    const after = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(after).toHaveLength(1);
    expect(after[0]!.linkType).toBe("supports");
    expect(after[0]!.source).toBe("manual");
  });

  it("ignores unresolved wikilinks (no matching title)", async () => {
    const a = await createNote("A");
    await syncWikilinks(db, a, "See [[NoSuchNote]]");
    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toEqual([]);
  });

  it("ignores self-references (wikilink to the note's own title)", async () => {
    const a = await createNote("A");
    await syncWikilinks(db, a, "See [[A]]");
    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toEqual([]);
  });

  it("deduplicates repeated wikilinks to the same target", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    await syncWikilinks(db, a, "[[B]] [[B]] [[B]]");
    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toHaveLength(1);
  });

  it("handles null body_md as 'no wikilinks'", async () => {
    const a = await createNote("A");
    const b = await createNote("B");
    await syncWikilinks(db, a, "[[B]]");
    await syncWikilinks(db, a, null);
    const links = await db
      .select()
      .from(schema.noteLinks)
      .where(eq(schema.noteLinks.fromNoteId, a));
    expect(links).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test wikilinks-sync`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/lib/wikilinks-sync.ts`**

```ts
import { and, eq, inArray, isNull } from "drizzle-orm";
import { extractWikilinks } from "@zk/shared";
import type { db as DB } from "../db/client";
import { notes, noteLinks } from "../db/schema";

type DrizzleDB = typeof DB;

export async function syncWikilinks(
  db: DrizzleDB,
  fromNoteId: string,
  bodyMd: string | null
): Promise<void> {
  // Step 1: extract distinct target titles from body, excluding self-references.
  const wikilinks = bodyMd ? extractWikilinks(bodyMd) : [];
  const distinctTitles = Array.from(new Set(wikilinks.map((w) => w.title)));

  // Step 2: resolve titles → note IDs (newest match wins for ambiguous titles).
  const matches =
    distinctTitles.length === 0
      ? []
      : await db
          .select({ id: notes.id, title: notes.title })
          .from(notes)
          .where(
            and(inArray(notes.title, distinctTitles), isNull(notes.archivedAt))
          );

  const titleToId = new Map<string, string>();
  for (const m of matches) {
    if (!titleToId.has(m.title)) titleToId.set(m.title, m.id);
  }

  const desiredTargets = new Set<string>();
  for (const title of distinctTitles) {
    const id = titleToId.get(title);
    if (id && id !== fromNoteId) desiredTargets.add(id);
  }

  // Step 3: fetch current wikilink rows for this note.
  const existing = await db
    .select({ id: noteLinks.id, toNoteId: noteLinks.toNoteId })
    .from(noteLinks)
    .where(
      and(eq(noteLinks.fromNoteId, fromNoteId), eq(noteLinks.source, "wikilink"))
    );

  const existingByTarget = new Map(existing.map((r) => [r.toNoteId, r.id]));
  const existingTargets = new Set(existing.map((r) => r.toNoteId));

  // Step 4: compute diff.
  const toInsert = [...desiredTargets].filter((t) => !existingTargets.has(t));
  const toDeleteIds = [...existingByTarget.entries()]
    .filter(([target]) => !desiredTargets.has(target))
    .map(([, id]) => id);

  // Step 5: apply in a transaction.
  await db.transaction(async (tx) => {
    if (toDeleteIds.length > 0) {
      await tx.delete(noteLinks).where(inArray(noteLinks.id, toDeleteIds));
    }
    if (toInsert.length > 0) {
      await tx.insert(noteLinks).values(
        toInsert.map((toNoteId) => ({
          fromNoteId,
          toNoteId,
          linkType: "references" as const,
          source: "wikilink" as const
        }))
      );
    }
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test wikilinks-sync`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): wikilink sync — diff body_md vs note_link rows"
```

---

## Task 9: Call `syncWikilinks` on note create + update

Plumb the sync into the route handlers so saves keep `note_link` aligned with body text.

**Files:**
- Modify: `apps/api/src/routes/notes.ts`
- Modify: `apps/api/tests/notes.test.ts`

- [ ] **Step 1: Append failing tests to `apps/api/tests/notes.test.ts`** — at the bottom of the file

```ts
describe("wikilink sync on note write", () => {
  it("POST with a wikilink creates the corresponding note_link", async () => {
    const target = (await (
      await post("/api/notes", { title: "Target", type: "permanent" })
    ).json()) as { id: string };

    const created = (await (
      await post("/api/notes", {
        title: "Source",
        type: "permanent",
        body_md: "see [[Target]]"
      })
    ).json()) as { id: string };

    const links = await (
      await app.request(`/api/notes/${created.id}/links`)
    ).json();
    expect((links as { outgoing: { to_note_id: string }[] }).outgoing).toHaveLength(1);
    expect((links as { outgoing: { to_note_id: string }[] }).outgoing[0]!.to_note_id).toBe(
      target.id
    );
  });

  it("PATCH that removes a wikilink removes the note_link", async () => {
    const target = (await (
      await post("/api/notes", { title: "T", type: "permanent" })
    ).json()) as { id: string };
    const src = (await (
      await post("/api/notes", {
        title: "S",
        type: "permanent",
        body_md: "[[T]]"
      })
    ).json()) as { id: string; updated_at: string };

    await app.request(`/api/notes/${src.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": src.updated_at
      },
      body: JSON.stringify({ body_md: "no link now" })
    });

    const links = (await (
      await app.request(`/api/notes/${src.id}/links`)
    ).json()) as { outgoing: unknown[] };
    expect(links.outgoing).toEqual([]);
  });

  it("manual links survive a wikilink-less PATCH", async () => {
    const target = (await (
      await post("/api/notes", { title: "T", type: "permanent" })
    ).json()) as { id: string };
    const src = (await (
      await post("/api/notes", {
        title: "S",
        type: "permanent",
        body_md: "first"
      })
    ).json()) as { id: string; updated_at: string };

    await post("/api/links", {
      from_note_id: src.id,
      to_note_id: target.id,
      link_type: "supports"
    });

    await app.request(`/api/notes/${src.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": src.updated_at
      },
      body: JSON.stringify({ body_md: "updated body" })
    });

    const links = (await (
      await app.request(`/api/notes/${src.id}/links`)
    ).json()) as { outgoing: { link_type: string; source: string }[] };
    expect(links.outgoing).toHaveLength(1);
    expect(links.outgoing[0]!.link_type).toBe("supports");
    expect(links.outgoing[0]!.source).toBe("manual");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zk/api test notes`
Expected: FAIL — the wikilink sync isn't wired in yet.

- [ ] **Step 3: Update `apps/api/src/routes/notes.ts`** — call `syncWikilinks` in both POST and PATCH handlers

Add to imports:

```ts
import { syncWikilinks } from "../lib/wikilinks-sync";
```

In the POST handler, after the insert and before `c.json(...)`, call sync:

```ts
notesRoute.post("/", zValidator("json", NewNoteSchema, zodErrorHook), async (c) => {
  const input = c.req.valid("json");
  const [created] = await db
    .insert(notes)
    .values({
      type: input.type,
      title: input.title,
      bodyMd: input.body_md ?? null
    })
    .returning();
  await syncWikilinks(db, created.id, created.bodyMd);
  return c.json(serializeNote(created, []), 201);
});
```

In the PATCH handler, after the `.update().returning()` and before computing tags:

```ts
const [updated] = await db
  .update(notes)
  .set({
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.type !== undefined ? { type: update.type } : {}),
    ...(update.body_md !== undefined ? { bodyMd: update.body_md } : {}),
    updatedAt: new Date()
  })
  .where(eq(notes.id, id))
  .returning();

// Re-sync wikilinks from the updated body.
await syncWikilinks(db, id, updated.bodyMd);

const tagsByNote = await fetchTagsFor([id]);
return c.json(serializeNote(updated, tagsByNote.get(id) ?? []));
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test`
Expected: PASS — all wikilink-sync route tests green; all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): sync wikilinks on note create and update"
```

---

## Task 10: Web — install CodeMirror packages

Add the editor dependencies. Use `@uiw/react-codemirror` as the React wrapper; it's a thin layer over CodeMirror 6.

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-workspace.yaml` if any new build scripts need approval

- [ ] **Step 1: Update `apps/web/package.json` to add the editor dependencies**

Read the file first. Add these to the `dependencies` section:

```json
"@codemirror/autocomplete": "^6.18.3",
"@codemirror/lang-markdown": "^6.3.1",
"@codemirror/language": "^6.10.6",
"@codemirror/state": "^6.5.0",
"@codemirror/view": "^6.35.0",
"@uiw/react-codemirror": "^4.23.7",
```

(Insert in alphabetical order between existing deps to keep the diff small.)

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: success. If pnpm complains about new build scripts (e.g., for `@codemirror/lang-markdown` or similar — none are expected for these packages, but check), add to `pnpm-workspace.yaml` `allowBuilds:` and re-run.

- [ ] **Step 3: Verify the install**

Run: `pnpm --filter @zk/web exec node -e "import('@uiw/react-codemirror').then(() => console.log('ok'))"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "chore(web): add codemirror 6 editor dependencies"
```

---

## Task 11: Web — search and links API client methods

Add the API client functions the editor and right rail will call.

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/tests/api-client-search-links.test.ts`

- [ ] **Step 1: Write failing test `apps/web/tests/api-client-search-links.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { api } from "../src/lib/api-client";

describe("api client — search and links", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("searchNotes() calls GET /api/notes/search with q", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ notes: [] }), { status: 200 })
    );
    await api.searchNotes("foo bar");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notes/search?q=foo+bar",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("getNoteLinks() calls GET /api/notes/:id/links", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ outgoing: [], incoming: [] }),
        { status: 200 }
      )
    );
    const result = await api.getNoteLinks("abc-id");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notes/abc-id/links",
      expect.objectContaining({ method: "GET" })
    );
    expect(result).toEqual({ outgoing: [], incoming: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zk/web test api-client-search-links`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Update `apps/web/src/lib/api-client.ts`** — add to imports and the `api` object

Add to the imports at top:

```ts
import type { Note, NewNote, NoteLink } from "@zk/shared";
```

Add new methods to the `api` object (after `archiveNote`):

```ts
searchNotes(q: string): Promise<{ notes: Pick<Note, "id" | "title" | "type">[] }> {
  const qs = new URLSearchParams({ q }).toString();
  return request(`/api/notes/search?${qs}`, { method: "GET" });
},

getNoteLinks(
  id: string
): Promise<{ outgoing: NoteLink[]; incoming: NoteLink[] }> {
  return request(`/api/notes/${id}/links`, { method: "GET" });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/web test`
Expected: PASS — all 5 web tests green (3 original + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): api client methods for search and getNoteLinks"
```

---

## Task 12: Web — CodeMirror wikilink extension

A self-contained module that creates a CodeMirror extension stack for wikilink decoration + autocomplete. Tested with vitest using the headless CodeMirror state APIs.

**Files:**
- Create: `apps/web/src/lib/cm-wikilinks.ts`
- Create: `apps/web/tests/cm-wikilinks.test.ts`

- [ ] **Step 1: Write failing test `apps/web/tests/cm-wikilinks.test.ts`**

The decoration extension is tested indirectly: we instantiate an `EditorView`, attach the plugin, and confirm the document and viewport survive. (Inspecting the actual decoration set requires a fully-rendered DOM and is brittle under jsdom.) The completion source is tested directly because it's pure.

```ts
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  wikilinkDecorations,
  wikilinkCompletionSource
} from "../src/lib/cm-wikilinks";

describe("wikilink decorations", () => {
  it("renders a doc with wikilinks without throwing", () => {
    const state = EditorState.create({
      doc: "see [[Foo]] and [[Bar]]",
      extensions: [wikilinkDecorations()]
    });
    const view = new EditorView({
      state,
      parent: document.createElement("div")
    });
    expect(view.state.doc.length).toBe("see [[Foo]] and [[Bar]]".length);
    view.destroy();
  });

  it("renders a doc without wikilinks without throwing", () => {
    const state = EditorState.create({
      doc: "plain text",
      extensions: [wikilinkDecorations()]
    });
    const view = new EditorView({
      state,
      parent: document.createElement("div")
    });
    expect(view.state.doc.toString()).toBe("plain text");
    view.destroy();
  });
});

describe("wikilinkCompletionSource", () => {
  it("returns null when not inside [[", async () => {
    const source = wikilinkCompletionSource(async () => ({ notes: [] }));
    const state = EditorState.create({ doc: "hello" });
    const ctx = new CompletionContext(state, 5, false);
    const result = await source(ctx);
    expect(result).toBeNull();
  });

  it("returns options when inside [[", async () => {
    const source = wikilinkCompletionSource(async () => ({
      notes: [
        { id: "1", title: "Foo Bar", type: "permanent" },
        { id: "2", title: "Foo Baz", type: "permanent" }
      ]
    }));
    const state = EditorState.create({ doc: "see [[foo" });
    const ctx = new CompletionContext(state, 9, true);
    const result = await source(ctx);
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(2);
    expect(result!.options.map((o) => o.label)).toEqual(["Foo Bar", "Foo Baz"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zk/web test cm-wikilinks`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/web/src/lib/cm-wikilinks.ts`**

```ts
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import {
  type CompletionContext,
  type CompletionResult,
  type CompletionSource
} from "@codemirror/autocomplete";
import { WIKILINK_REGEX } from "@zk/shared";

const wikilinkMark = Decoration.mark({ class: "cm-wikilink" });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const re = new RegExp(WIKILINK_REGEX.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = from + m.index;
      const end = start + m[0].length;
      builder.add(start, end, wikilinkMark);
    }
  }
  return builder.finish();
}

export function wikilinkDecorations() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

type SearchFn = (q: string) => Promise<{
  notes: { id: string; title: string; type: string }[];
}>;

export function wikilinkCompletionSource(searchFn: SearchFn): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    // Look backwards from the cursor for an unclosed `[[`.
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.doc.sliceString(line.from, ctx.pos);
    const open = before.lastIndexOf("[[");
    if (open === -1) return null;
    // If a closing ]] occurs between open and cursor, we're past the link.
    const closeBetween = before.indexOf("]]", open);
    if (closeBetween !== -1 && closeBetween + line.from < ctx.pos) return null;

    const q = before.slice(open + 2);
    if (!ctx.explicit && q.length === 0) return null;

    const { notes } = await searchFn(q.length > 0 ? q : " ");
    return {
      from: line.from + open + 2,
      to: ctx.pos,
      options: notes.map((n) => ({
        label: n.title,
        detail: n.type,
        apply: (view, _completion, from, to) => {
          // Replace from current open position through `]]` if present, else insert `]]`.
          const docAfter = view.state.doc.sliceString(to, to + 2);
          const insertion = docAfter === "]]" ? n.title : `${n.title}]]`;
          view.dispatch({
            changes: { from, to, insert: insertion },
            selection: { anchor: from + insertion.length }
          });
        }
      })),
      validFor: /^[^\[\]\n]*$/
    };
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/web test cm-wikilinks`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): codemirror wikilink decorations and completion source"
```

---

## Task 13: Web — NoteEditor component

A React component that wraps CodeMirror with markdown + wikilink extensions, plus a stylesheet entry for the `.cm-wikilink` decoration class.

**Files:**
- Create: `apps/web/src/components/NoteEditor.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Create `apps/web/src/components/NoteEditor.tsx`**

```tsx
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { autocompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { useMemo } from "react";
import { api } from "../lib/api-client";
import {
  wikilinkDecorations,
  wikilinkCompletionSource
} from "../lib/cm-wikilinks";

const theme = EditorView.theme({
  "&": {
    fontSize: "14px",
    backgroundColor: "#1a1a1a",
    color: "#e8e8e8",
    border: "1px solid #333",
    borderRadius: "4px"
  },
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    padding: "12px"
  },
  ".cm-focused": { outline: "none" },
  ".cm-wikilink": {
    color: "#7aa2f7",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    cursor: "pointer"
  }
}, { dark: true });

interface NoteEditorProps {
  value: string;
  onChange: (next: string) => void;
}

export function NoteEditor({ value, onChange }: NoteEditorProps) {
  const extensions = useMemo(
    () => [
      markdown(),
      theme,
      wikilinkDecorations(),
      autocompletion({
        override: [wikilinkCompletionSource((q) => api.searchNotes(q))]
      })
    ],
    []
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false
      }}
      style={{ marginTop: 16 }}
    />
  );
}
```

- [ ] **Step 2: Update `apps/web/src/styles.css`** — append the wikilink and panel classes at the bottom of the file

```css

.links-panel {
  padding: 12px;
  background: #161616;
  border: 1px solid #222;
  border-radius: 4px;
}

.links-panel h4 {
  margin: 0 0 8px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
}

.links-panel-group {
  margin-bottom: 12px;
}

.links-panel-group:last-child {
  margin-bottom: 0;
}

.links-panel-empty {
  color: #555;
  font-size: 13px;
}

.note-top-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 13px;
}

.note-type-chip {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 2px 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 11px;
  color: #aaa;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): NoteEditor component (codemirror + markdown + wikilinks)"
```

---

## Task 14: Web — LinksPanel component

Right-rail panel showing outbound and incoming links grouped by `link_type`.

**Files:**
- Create: `apps/web/src/components/LinksPanel.tsx`

- [ ] **Step 1: Create `apps/web/src/components/LinksPanel.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
                      {l.to_note_id.slice(0, 8)}…
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
                      {l.from_note_id.slice(0, 8)}…
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

Note: the link list shows truncated IDs because the link response doesn't include target titles. Resolving titles for backlinks is a Plan 3 enhancement (efficient batched fetch); for Plan 2 the truncated ID is enough to navigate.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): LinksPanel right-rail component"
```

---

## Task 15: Web — NoteTopBar component

Top bar showing the type chip, tags as chips, and last-edited timestamp.

**Files:**
- Create: `apps/web/src/components/NoteTopBar.tsx`

- [ ] **Step 1: Create `apps/web/src/components/NoteTopBar.tsx`**

```tsx
import type { Note } from "@zk/shared";

interface NoteTopBarProps {
  note: Note;
  onBack: () => void;
}

export function NoteTopBar({ note, onBack }: NoteTopBarProps) {
  return (
    <div className="note-top-bar">
      <button onClick={onBack}>← Back</button>
      <span className="note-type-chip">{note.type}</span>
      {note.tags.map((t) => (
        <span key={t} className="tag-chip">
          {t}
        </span>
      ))}
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

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "feat(web): NoteTopBar component"
```

---

## Task 16: Web — wire NoteEditor + LinksPanel + NoteTopBar into the detail page

Replace the textarea in `notes.$noteId.tsx` with NoteEditor, add LinksPanel to the right rail, replace the manual back button + timestamp with NoteTopBar.

**Files:**
- Modify: `apps/web/src/routes/notes.$noteId.tsx`

- [ ] **Step 1: Read the current `apps/web/src/routes/notes.$noteId.tsx`**

You're replacing the textarea-based editor with the NoteEditor component, replacing the top of the page with NoteTopBar, and adding a two-column layout where the right column is the LinksPanel.

- [ ] **Step 2: Replace the file content**

```tsx
import {
  createFileRoute,
  useNavigate,
  useRouter
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api-client";
import { NoteEditor } from "../components/NoteEditor";
import { LinksPanel } from "../components/LinksPanel";
import { NoteTopBar } from "../components/NoteTopBar";

export const Route = createFileRoute("/notes/$noteId")({
  component: NoteDetail
});

function NoteDetail() {
  const { noteId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();

  const noteQuery = useQuery({
    queryKey: ["notes", noteId],
    queryFn: () => api.getNote(noteId)
  });

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (noteQuery.data) {
      setTitle(noteQuery.data.title);
      setBody(noteQuery.data.body_md ?? "");
    }
  }, [noteQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!noteQuery.data) throw new Error("no note");
      const isTopic = noteQuery.data.type === "topic";
      return api.updateNote(
        noteId,
        {
          title,
          ...(isTopic ? {} : { body_md: body })
        },
        noteQuery.data.updated_at
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", noteId] });
      qc.invalidateQueries({ queryKey: ["notes", noteId, "links"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    }
  });

  const archiveMutation = useMutation({
    mutationFn: () => api.archiveNote(noteId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["notes"] });
      navigate({ to: "/" });
    }
  });

  if (noteQuery.isLoading) return <p>Loading…</p>;
  if (noteQuery.isError)
    return (
      <p style={{ color: "#f7768e" }}>
        Failed to load: {String(noteQuery.error)}
      </p>
    );
  if (!noteQuery.data) return null;

  const isTopic = noteQuery.data.type === "topic";

  return (
    <div>
      <NoteTopBar note={noteQuery.data} onBack={() => router.history.back()} />

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ width: "100%", fontSize: 24, marginTop: 16 }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          gap: 16,
          marginTop: 16
        }}
      >
        <div>
          {isTopic ? (
            <p style={{ color: "#888" }}>
              Topic notes have no body. The title is the description.
            </p>
          ) : (
            <NoteEditor value={body} onChange={setBody} />
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                if (confirm("Archive this note?")) archiveMutation.mutate();
              }}
            >
              Archive
            </button>
            {updateMutation.isError && (
              <span style={{ color: "#f7768e", alignSelf: "center" }}>
                {String(updateMutation.error)}
              </span>
            )}
          </div>
        </div>

        <LinksPanel noteId={noteId} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @zk/web typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): wire NoteEditor, LinksPanel, NoteTopBar into detail page"
```

---

## Task 17: End-to-end verification

Run the full stack, exercise the editor, confirm wikilinks sync into the DB.

**Files:**
- (None — verification only.)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all packages green. Total should be:
- `@zk/shared`: 11 baseline + 3 nullable body + 8 wikilinks = ~22 tests
- `@zk/api`: 33 baseline + 3 errors + 2 PATCH + 5 search + 2 tags + 3 wikilink-route + 7 wikilink-sync ≈ ~55 tests
- `@zk/web`: 3 baseline + 2 search/links + 4 cm-wikilinks = ~9 tests

Total approximate: ~86 tests.

- [ ] **Step 2: Run typecheck across the workspace**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke test (if foreground servers are available)**

In one terminal: `pnpm dev:api`
In another: `pnpm dev:web`
Open http://localhost:5173.

Do the following sequence and report results in the commit body of Step 5:

1. Create a permanent note titled "Target" with body "I am the target."
2. Create another permanent note titled "Source" and edit its body to:
   ```
   I link to [[Target]] and to [[NoSuchNote]] and [[Target]] again.
   ```
3. Type `[[Tar` in the body — autocomplete should pop a dropdown including "Target".
4. Save.
5. Reload — the body should still contain the wikilinks.
6. Curl the API: `curl -s http://localhost:3001/api/notes/<source-id>/links | jq` — there should be exactly one outgoing link to the Target note ID, with `link_type: "references"` and `source: "wikilink"`.
7. The right rail of the Source note's page should show the outgoing link under "Outgoing → references".
8. Open the Target note — the right rail "Backlinks → references" should show the Source.

If any step fails, fix the bug before committing.

- [ ] **Step 4: Update the README** — add a "Current status" note for Plan 2 completion

Replace the "Current status" section of `README.md` with:

```markdown
## Current status

M1 Plan 1 (Foundation) and Plan 2 (Editor + Wikilinks) complete. The stack supports note + link + tag CRUD, a CodeMirror 6 markdown editor with `[[wikilink]]` autocomplete and decoration, a right-rail backlinks panel, and a top bar showing type/tags/last-edited. Wikilinks auto-sync into the `note_link` table on save.
```

- [ ] **Step 5: Commit the README update**

```bash
git add README.md
git commit -m "docs: update readme for M1 Plan 2 completion"
```

---

## Verification checklist (final, post-implementation)

- [ ] `pnpm test` passes (~86 tests).
- [ ] `pnpm -r typecheck` is clean.
- [ ] Manual editor smoke test: typing `[[` triggers autocomplete; saving derives `note_link` rows; deleting the wikilink removes the row.
- [ ] Manual links smoke test: `POST /api/links` with `link_type: "supports"` survives subsequent body PATCH-es with no wikilink-related impact.
- [ ] Manual error-shape smoke test: `curl -s -X POST http://localhost:3001/api/notes -H "content-type: application/json" -d '{"type":"topic","body_md":"x"}'` returns `{"error": "..."}` (not `{"success":false,...}`).
- [ ] Manual nullable-body smoke test: PATCH `{body_md: null, type: "topic"}` on a permanent note with body succeeds.

---

## What's deliberately NOT in this plan

- Slash menu (`/`) for inserting callouts/code blocks/citations — deferred to a later editor-polish pass.
- Tag editing UI (chips are display-only in this plan) — Plan 3 adds tag inline editing alongside the search/⌘K work.
- Sigma.js graph view — Plan 3.
- Full-text search via Postgres FTS — Plan 3 (the autocomplete search uses ILIKE, which is good enough for this).
- Hover-peek for `[[wikilinks]]` showing the target note's body in a popover — flagged as a refinement; Plan 2 ships decoration + click-to-navigate via the visible wikilink underline, but the hover-peek tooltip is left for Plan 2.5 if needed.
- Cmd+click navigation on a wikilink. Same reasoning — decoration + autocomplete are the core daily-use needs; navigation by click is a polish task that can land in a follow-up.
- Related-notes panel in the editor right rail — M3 ML.
- Literature-note pinned source block — Plan 5 (Readwise).
- Backlink list rendered with target titles instead of truncated IDs — Plan 3 (efficient batched title fetch tied to the upcoming search work).
- "Open canvas" button on topic notes — M2.

These are non-blocking, deliberate deferrals.
