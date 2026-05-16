# Notion Import Implementation Plan (M1, Plan 6 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import an existing Notion zettelkasten in two API-driven steps. `POST /api/notion/preview` walks a Notion database, fetches block content, applies heuristic note typing, and returns a preview. The web `/import/notion` route lets the user paste credentials, review proposed types, bulk re-classify, and commit. `POST /api/notion/commit` inserts the notes idempotently by `notion_page_id`. Notion `@page` mentions become wikilinks in the imported body, resolved against the same import set.

**Architecture:** The Notion fetch + transform logic lives in `apps/api/src/notion/` (not a separate worker — it's one-time and runs on demand from the web UI, not on a schedule). A typed `notionClient` wraps `@notionhq/client`. The heuristic typer is a pure function over Notion's page-property and structural signals. Bodies are converted from Notion blocks to plain markdown by a small block-walker (no external library). Wikilinks are resolved in a second pass after all notes have been inserted, by looking up `notion_page_id` and rewriting the body with `[[Title]]`. The token never persists — it travels in the API request body and is dropped after the request returns. Two Plan 5 carry-overs are front-loaded.

**Tech Stack:** `@notionhq/client` (typed Notion SDK), existing Drizzle + Hono on the API side, existing React Query + TanStack Router on the web side.

---

## File Structure

```
apps/mirror/package.json                       (modify) — drop stale @zk/shared
apps/mirror/tsconfig.json                      (modify) — drop stale @zk/shared reference

apps/readwise/src/sync.ts                      (modify) — onConflictDoUpdate

apps/api/
├── package.json                               (modify) — add @notionhq/client
└── src/
    ├── server.ts                              (modify) — mount /api/notion routes
    ├── routes/
    │   └── notion.ts                          (create) — preview + commit endpoints
    ├── notion/
    │   ├── client.ts                          (create) — typed Notion API wrapper
    │   ├── typer.ts                           (create) — heuristic note typing
    │   ├── blocks-to-markdown.ts              (create) — body conversion
    │   ├── mentions.ts                        (create) — mention extraction + rewriting
    │   └── import.ts                          (create) — preview + commit orchestration
    └── tests/
        ├── notion-typer.test.ts               (create)
        ├── notion-blocks.test.ts              (create)
        ├── notion-mentions.test.ts            (create)
        └── notion-import.test.ts              (create) — DB-backed commit test

apps/web/src/
├── lib/api-client.ts                          (modify) — notionPreview, notionCommit
├── routes/
│   ├── __root.tsx                             (modify) — link to /import/notion
│   └── import.notion.tsx                      (create) — the import UI
└── components/
    └── NotionImportPreview.tsx                (create) — preview table with bulk re-type
```

**Why this layout**

- `apps/api/src/notion/` groups the Notion-specific logic into one folder rather than scattering it across `lib/` and `routes/`. Each concern (client, typer, body conversion, mention handling, orchestration) gets its own file so any of them can be edited or replaced without dragging the others along.
- The import lives inside the existing API rather than a new `apps/notion-import` worker. One-time work doesn't need a long-lived process; running it through HTTP from the UI gives us free state management, error reporting, and a single deployable unit.
- The mention rewriter is its own file because it runs twice — once during preview (to extract target Notion page IDs) and once during commit (to replace mentions with resolved `[[Title]]` wikilinks).
- `NotionImportPreview.tsx` is a chunky component (a table with selectable rows and bulk actions); keeping it separate from the route file keeps the route a thin wrapper around the query + mutation hooks.

---

## Conventions

- **`@notionhq/client` 2.x** — the official SDK. Stable, well-typed. Network calls go through this; we never `fetch` Notion directly.
- **Notion API token + database ID never persist.** They live in the API request body for one call, get consumed by the handler, and are not logged.
- **Tests use mocked `notionClient`.** The DB-backed `notion-import.test.ts` exercises the orchestration end-to-end (preview → commit → DB rows) without hitting Notion.
- Established patterns: TDD per task, Drizzle `tx`-passing helpers, `zodErrorHook` on every `zValidator` call, `noUncheckedIndexedAccess`, port 5433.

---

## Task 1: Mirror — drop stale `@zk/shared` dep (Plan 5 carry-over)

**Files:**
- Modify: `apps/mirror/package.json` — remove `@zk/shared` from `dependencies`
- Modify: `apps/mirror/tsconfig.json` — remove the `@zk/shared` project reference

- [ ] **Step 1: Read `apps/mirror/package.json`**

Verify `@zk/shared` is in `dependencies` but not imported anywhere under `apps/mirror/src/` or `apps/mirror/tests/`:

```bash
grep -r "@zk/shared" apps/mirror/src apps/mirror/tests || echo "no references"
```

Expected: `no references`.

- [ ] **Step 2: Remove the dep**

Read the file. Inside `dependencies`, delete the `"@zk/shared": "workspace:*"` line.

- [ ] **Step 3: Update `apps/mirror/tsconfig.json`**

Read the file. The `references` array currently has both `packages/shared` and `packages/db-schema`. Remove the `packages/shared` entry:

```json
"references": [
  { "path": "../../packages/db-schema" }
]
```

- [ ] **Step 4: Re-install + typecheck**

```bash
pnpm install
pnpm --filter @zk/mirror typecheck
pnpm --filter @zk/mirror test
```

All clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mirror/package.json apps/mirror/tsconfig.json pnpm-lock.yaml
git commit -m "chore(mirror): drop unused @zk/shared dependency"
```

---

## Task 2: Readwise — `onConflictDoUpdate` for re-edited highlights (Plan 5 carry-over)

The sync currently uses `onConflictDoNothing`, so edits made in Readwise after the first sync never propagate. Switch to `onConflictDoUpdate` so re-edits sync.

**Files:**
- Modify: `apps/readwise/src/sync.ts`
- Modify: `apps/readwise/tests/sync.test.ts`

- [ ] **Step 1: Append a failing test to `apps/readwise/tests/sync.test.ts`** — inside `describe("runSync", ...)`

```ts
  it("updates highlight text on re-sync when the source data changed", async () => {
    const bookV1 = {
      ...sampleBook,
      highlights: [
        {
          id: 1,
          text: "old text",
          note: null,
          location: 10,
          location_type: "order",
          highlighted_at: "2026-05-15T10:00:00Z",
          color: "yellow"
        }
      ]
    };
    const bookV2 = {
      ...sampleBook,
      highlights: [
        {
          id: 1,
          text: "edited text",
          note: "now with a note",
          location: 10,
          location_type: "order",
          highlighted_at: "2026-05-15T10:00:00Z",
          color: "blue"
        }
      ]
    };

    await runSync(url, makeFakeClient([{ books: [bookV1], nextPageCursor: null }]));
    await runSync(url, makeFakeClient([{ books: [bookV2], nextPageCursor: null }]));

    const rows = await db.select().from(schema.highlights);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("edited text");
    expect(rows[0]!.noteText).toBe("now with a note");
    expect(rows[0]!.color).toBe("blue");
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @zk/readwise test sync`
Expected: FAIL — `text` is still `"old text"`.

- [ ] **Step 3: Switch `insertHighlights` to `onConflictDoUpdate`**

Read `apps/readwise/src/sync.ts`. Find the `insertHighlights` function and its `.onConflictDoNothing()` call. Replace with:

```ts
async function insertHighlights(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sourceId: string,
  book: ReadwiseBook
): Promise<number> {
  let inserted = 0;
  for (const h of book.highlights) {
    const readwiseHighlightId = String(h.id);
    // Look up the existing row to differentiate insert vs update for the counter.
    const existing = await db
      .select({ id: highlights.id })
      .from(highlights)
      .where(eq(highlights.readwiseHighlightId, readwiseHighlightId));

    if (existing.length === 0) {
      await db.insert(highlights).values({
        sourceId,
        text: h.text,
        noteText: h.note ?? null,
        location:
          h.location !== undefined && h.location !== null
            ? String(h.location)
            : null,
        color: h.color ?? null,
        readwiseHighlightId
      });
      inserted++;
    } else {
      await db
        .update(highlights)
        .set({
          text: h.text,
          noteText: h.note ?? null,
          location:
            h.location !== undefined && h.location !== null
              ? String(h.location)
              : null,
          color: h.color ?? null
        })
        .where(eq(highlights.readwiseHighlightId, readwiseHighlightId));
    }
  }
  return inserted;
}
```

The SELECT-then-INSERT-or-UPDATE pattern is safe under the worker's `inFlight` guard (no concurrent sync runs). The counter only increments on true inserts so the existing test for `highlightsInserted` count still holds.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/readwise test`
Expected: PASS — all 4 sync tests + 3 client tests (7 total).

- [ ] **Step 5: Commit**

```bash
git add apps/readwise
git commit -m "fix(readwise): update highlight text on re-sync when source data changes"
```

---

## Task 3: Add `@notionhq/client` dependency

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add the dep**

Read `apps/api/package.json`. Inside `dependencies`, add `"@notionhq/client": "^2.2.15"` in alphabetical position (before `@zk/db-schema`).

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: success. If pnpm complains about new build scripts (none expected for `@notionhq/client`), add to `pnpm-workspace.yaml` `allowBuilds:` and re-run.

- [ ] **Step 3: Smoke import**

Run: `pnpm --filter @zk/api exec node -e "import('@notionhq/client').then((m) => console.log(typeof m.Client))"`
Expected: prints `function`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add @notionhq/client"
```

---

## Task 4: Notion API client wrapper

A thin abstraction over `@notionhq/client` that exposes only the calls we need (query a database for pages, fetch a page's block children). Lets us mock cleanly in tests.

**Files:**
- Create: `apps/api/src/notion/client.ts`
- Create: `apps/api/tests/notion-client.test.ts`

- [ ] **Step 1: Write failing test `apps/api/tests/notion-client.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { makeNotionClient } from "../src/notion/client";

describe("notionClient.listDatabasePages", () => {
  it("queries the database and returns pages", async () => {
    const fakeNotion = {
      databases: {
        query: vi.fn().mockResolvedValueOnce({
          results: [
            {
              object: "page",
              id: "page-1",
              properties: {
                Name: {
                  type: "title",
                  title: [{ plain_text: "Hello" }]
                }
              }
            }
          ],
          has_more: false,
          next_cursor: null
        })
      }
    };
    const client = makeNotionClient(fakeNotion as never);
    const pages = await client.listDatabasePages("db-1");
    expect(pages).toHaveLength(1);
    expect(pages[0]!.id).toBe("page-1");
    expect(fakeNotion.databases.query).toHaveBeenCalledWith({
      database_id: "db-1",
      start_cursor: undefined,
      page_size: 100
    });
  });

  it("paginates via next_cursor", async () => {
    const fakeNotion = {
      databases: {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            results: [{ object: "page", id: "page-1", properties: {} }],
            has_more: true,
            next_cursor: "cursor-1"
          })
          .mockResolvedValueOnce({
            results: [{ object: "page", id: "page-2", properties: {} }],
            has_more: false,
            next_cursor: null
          })
      }
    };
    const client = makeNotionClient(fakeNotion as never);
    const pages = await client.listDatabasePages("db-1");
    expect(pages.map((p) => p.id)).toEqual(["page-1", "page-2"]);
    expect(fakeNotion.databases.query).toHaveBeenCalledTimes(2);
  });
});

describe("notionClient.listBlockChildren", () => {
  it("returns block children", async () => {
    const fakeNotion = {
      blocks: {
        children: {
          list: vi.fn().mockResolvedValueOnce({
            results: [
              {
                object: "block",
                id: "block-1",
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "hi" }] }
              }
            ],
            has_more: false,
            next_cursor: null
          })
        }
      }
    };
    const client = makeNotionClient(fakeNotion as never);
    const blocks = await client.listBlockChildren("page-1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.id).toBe("block-1");
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `pnpm --filter @zk/api test notion-client`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/notion/client.ts`**

```ts
import type { Client } from "@notionhq/client";

// Permissive shape — we only read fields that exist on responses, so
// "any" here means "trust the SDK at the call sites that care about types."
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotionPage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotionBlock = any;

export interface NotionClient {
  listDatabasePages(databaseId: string): Promise<NotionPage[]>;
  listBlockChildren(pageId: string): Promise<NotionBlock[]>;
}

export function makeNotionClient(notion: Client): NotionClient {
  return {
    async listDatabasePages(databaseId) {
      const pages: NotionPage[] = [];
      let cursor: string | undefined = undefined;
      do {
        const res = await notion.databases.query({
          database_id: databaseId,
          start_cursor: cursor,
          page_size: 100
        });
        pages.push(...res.results);
        cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
      } while (cursor);
      return pages;
    },
    async listBlockChildren(pageId) {
      const blocks: NotionBlock[] = [];
      let cursor: string | undefined = undefined;
      do {
        const res = await notion.blocks.children.list({
          block_id: pageId,
          start_cursor: cursor,
          page_size: 100
        });
        blocks.push(...res.results);
        cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
      } while (cursor);
      return blocks;
    }
  };
}

// Convenience helper for constructing the client from a token. Kept separate
// so tests can pass a mocked `Client` directly.
export function makeNotionClientFromToken(token: string): NotionClient {
  // Dynamic import keeps the optional Client class out of the unit-test bundle.
  // The route file uses `import { Client } from "@notionhq/client"` at the top
  // and passes the instance to `makeNotionClient`. This factory is for cases
  // where you only have a token.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require("@notionhq/client");
  return makeNotionClient(new Client({ auth: token }));
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test notion-client`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): typed Notion client wrapper (listDatabasePages, listBlockChildren)"
```

---

## Task 5: Heuristic note typer

Pure function that classifies a Notion page into `fleeting | literature | permanent | topic` from its structural signals.

**Files:**
- Create: `apps/api/src/notion/typer.ts`
- Create: `apps/api/tests/notion-typer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/notion-typer.test.ts
import { describe, it, expect } from "vitest";
import { detectType } from "../src/notion/typer";

describe("detectType", () => {
  it("returns the explicit Type property when present", () => {
    const page = {
      properties: {
        Type: {
          type: "select",
          select: { name: "permanent" }
        }
      }
    };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 500 })).toBe(
      "permanent"
    );
  });

  it("uses 'literature' when a Source/Author/URL property is present", () => {
    const page = {
      properties: {
        Source: { type: "rich_text", rich_text: [{ plain_text: "Foucault" }] }
      }
    };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 100 })).toBe(
      "literature"
    );
  });

  it("uses 'topic' when a page is heavily linked to from other pages", () => {
    const page = { properties: {} };
    expect(detectType(page, { inboundMentions: 8, bodyLength: 50 })).toBe(
      "topic"
    );
  });

  it("uses 'permanent' for pages with substantive prose and no other signals", () => {
    const page = { properties: {} };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 800 })).toBe(
      "permanent"
    );
  });

  it("falls back to 'fleeting' for short, unlinked pages", () => {
    const page = { properties: {} };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 50 })).toBe(
      "fleeting"
    );
  });

  it("normalizes case on the explicit Type value", () => {
    const page = {
      properties: {
        Type: { type: "select", select: { name: "Topic" } }
      }
    };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 0 })).toBe(
      "topic"
    );
  });

  it("ignores an unknown explicit Type value and falls through", () => {
    const page = {
      properties: {
        Type: { type: "select", select: { name: "project" } }
      }
    };
    expect(detectType(page, { inboundMentions: 0, bodyLength: 50 })).toBe(
      "fleeting"
    );
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm --filter @zk/api test notion-typer`
Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/notion/typer.ts`**

```ts
import type { NotionPage } from "./client";

export type NoteType = "fleeting" | "literature" | "permanent" | "topic";

export interface TypeSignals {
  inboundMentions: number;
  bodyLength: number;
}

const VALID_TYPES: ReadonlySet<NoteType> = new Set([
  "fleeting",
  "literature",
  "permanent",
  "topic"
]);

const TOPIC_MENTION_THRESHOLD = 5;
const PROSE_BODY_THRESHOLD = 400;

function selectName(prop: unknown): string | null {
  if (!prop || typeof prop !== "object") return null;
  const p = prop as { type?: string; select?: { name?: string } | null };
  if (p.type === "select" && p.select?.name) return p.select.name;
  return null;
}

export function detectType(page: NotionPage, signals: TypeSignals): NoteType {
  const properties = (page?.properties ?? {}) as Record<string, unknown>;

  // 1. Explicit Type property wins, if recognized.
  const explicit = selectName(properties.Type);
  if (explicit) {
    const normalized = explicit.toLowerCase();
    if (VALID_TYPES.has(normalized as NoteType)) return normalized as NoteType;
  }

  // 2. Source/Author/URL property → literature.
  if (properties.Source || properties.Author || properties.URL) {
    return "literature";
  }

  // 3. Heavily linked-to → topic.
  if (signals.inboundMentions >= TOPIC_MENTION_THRESHOLD) return "topic";

  // 4. Substantive prose → permanent.
  if (signals.bodyLength >= PROSE_BODY_THRESHOLD) return "permanent";

  // 5. Otherwise fleeting.
  return "fleeting";
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test notion-typer`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): heuristic note typer for Notion pages"
```

---

## Task 6: Blocks-to-markdown converter

Walk a Notion block tree and produce plain markdown. Handles the most common block types; falls back to a comment for unsupported types.

**Files:**
- Create: `apps/api/src/notion/blocks-to-markdown.ts`
- Create: `apps/api/tests/notion-blocks.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/notion-blocks.test.ts
import { describe, it, expect } from "vitest";
import { blocksToMarkdown } from "../src/notion/blocks-to-markdown";

function richText(text: string): { plain_text: string; href?: string }[] {
  return [{ plain_text: text }];
}

describe("blocksToMarkdown", () => {
  it("converts a paragraph", () => {
    const out = blocksToMarkdown([
      { type: "paragraph", paragraph: { rich_text: richText("Hello world") } }
    ]);
    expect(out.trim()).toBe("Hello world");
  });

  it("converts headings 1-3", () => {
    const out = blocksToMarkdown([
      { type: "heading_1", heading_1: { rich_text: richText("Big") } },
      { type: "heading_2", heading_2: { rich_text: richText("Med") } },
      { type: "heading_3", heading_3: { rich_text: richText("Small") } }
    ]);
    expect(out).toContain("# Big");
    expect(out).toContain("## Med");
    expect(out).toContain("### Small");
  });

  it("converts bulleted and numbered lists", () => {
    const out = blocksToMarkdown([
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText("A") }
      },
      {
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText("B") }
      },
      {
        type: "numbered_list_item",
        numbered_list_item: { rich_text: richText("First") }
      }
    ]);
    expect(out).toContain("- A");
    expect(out).toContain("- B");
    expect(out).toContain("1. First");
  });

  it("converts a fenced code block", () => {
    const out = blocksToMarkdown([
      {
        type: "code",
        code: {
          rich_text: richText("console.log('hi')"),
          language: "javascript"
        }
      }
    ]);
    expect(out).toContain("```javascript\nconsole.log('hi')\n```");
  });

  it("converts a quote", () => {
    const out = blocksToMarkdown([
      { type: "quote", quote: { rich_text: richText("Said someone") } }
    ]);
    expect(out).toContain("> Said someone");
  });

  it("emits a comment fallback for unsupported block types", () => {
    const out = blocksToMarkdown([
      { type: "image", image: { type: "external", external: { url: "x" } } }
    ]);
    expect(out).toContain("<!-- unsupported block: image -->");
  });

  it("preserves page mentions as inline tokens for later resolution", () => {
    const out = blocksToMarkdown([
      {
        type: "paragraph",
        paragraph: {
          rich_text: [
            { plain_text: "See " },
            {
              type: "mention",
              mention: {
                type: "page",
                page: { id: "abc-def-1234" }
              },
              plain_text: "Other Page"
            },
            { plain_text: " for more" }
          ]
        }
      }
    ]);
    expect(out).toContain("[[notion:page:abc-def-1234|Other Page]]");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm --filter @zk/api test notion-blocks`
Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/notion/blocks-to-markdown.ts`**

```ts
import type { NotionBlock } from "./client";

type RichTextItem = {
  plain_text?: string;
  type?: string;
  mention?: {
    type?: string;
    page?: { id?: string };
  };
};

function renderRichText(items: RichTextItem[] | undefined): string {
  if (!items) return "";
  return items
    .map((it) => {
      if (it.type === "mention" && it.mention?.type === "page") {
        const pageId = it.mention.page?.id ?? "";
        const label = it.plain_text ?? "";
        return `[[notion:page:${pageId}|${label}]]`;
      }
      return it.plain_text ?? "";
    })
    .join("");
}

export function blocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const type = (block as { type?: string }).type;
    switch (type) {
      case "paragraph": {
        const rt = (block as { paragraph?: { rich_text?: RichTextItem[] } })
          .paragraph?.rich_text;
        lines.push(renderRichText(rt));
        lines.push("");
        break;
      }
      case "heading_1":
      case "heading_2":
      case "heading_3": {
        const level = type === "heading_1" ? "#" : type === "heading_2" ? "##" : "###";
        const rt = (block as Record<string, { rich_text?: RichTextItem[] }>)[type]
          ?.rich_text;
        lines.push(`${level} ${renderRichText(rt)}`);
        lines.push("");
        break;
      }
      case "bulleted_list_item": {
        const rt = (block as { bulleted_list_item?: { rich_text?: RichTextItem[] } })
          .bulleted_list_item?.rich_text;
        lines.push(`- ${renderRichText(rt)}`);
        break;
      }
      case "numbered_list_item": {
        const rt = (block as { numbered_list_item?: { rich_text?: RichTextItem[] } })
          .numbered_list_item?.rich_text;
        lines.push(`1. ${renderRichText(rt)}`);
        break;
      }
      case "code": {
        const c = (block as {
          code?: { rich_text?: RichTextItem[]; language?: string };
        }).code;
        lines.push(`\`\`\`${c?.language ?? ""}`);
        lines.push(renderRichText(c?.rich_text));
        lines.push("```");
        lines.push("");
        break;
      }
      case "quote": {
        const rt = (block as { quote?: { rich_text?: RichTextItem[] } }).quote
          ?.rich_text;
        lines.push(`> ${renderRichText(rt)}`);
        lines.push("");
        break;
      }
      case "divider":
        lines.push("---");
        lines.push("");
        break;
      default:
        lines.push(`<!-- unsupported block: ${type} -->`);
        lines.push("");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test notion-blocks`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): Notion blocks to markdown converter"
```

---

## Task 7: Mention extraction + wikilink rewriting

Two pure functions: extract all Notion page-mention IDs from a converted body, and rewrite the placeholders into `[[Title]]` once resolution is known.

**Files:**
- Create: `apps/api/src/notion/mentions.ts`
- Create: `apps/api/tests/notion-mentions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/notion-mentions.test.ts
import { describe, it, expect } from "vitest";
import { extractMentionIds, rewriteMentions } from "../src/notion/mentions";

describe("extractMentionIds", () => {
  it("returns empty for a body with no mentions", () => {
    expect(extractMentionIds("just text")).toEqual([]);
  });

  it("extracts a single mention id", () => {
    expect(
      extractMentionIds("see [[notion:page:abc-1234|Other]] for more")
    ).toEqual(["abc-1234"]);
  });

  it("deduplicates repeated mentions", () => {
    expect(
      extractMentionIds(
        "[[notion:page:abc-1|X]] and [[notion:page:abc-1|X]]"
      )
    ).toEqual(["abc-1"]);
  });

  it("extracts multiple distinct mentions", () => {
    expect(
      extractMentionIds(
        "[[notion:page:a-1|A]] and [[notion:page:b-2|B]]"
      ).sort()
    ).toEqual(["a-1", "b-2"]);
  });
});

describe("rewriteMentions", () => {
  it("replaces a mention with [[Title]] when a title is provided", () => {
    const out = rewriteMentions(
      "see [[notion:page:abc-1|FallbackLabel]] here",
      new Map([["abc-1", "Resolved Title"]])
    );
    expect(out).toBe("see [[Resolved Title]] here");
  });

  it("falls back to the embedded label when no title is provided", () => {
    const out = rewriteMentions(
      "see [[notion:page:abc-1|FallbackLabel]] here",
      new Map()
    );
    expect(out).toBe("see [[FallbackLabel]] here");
  });

  it("handles multiple mentions in one body", () => {
    const out = rewriteMentions(
      "[[notion:page:a|A]] and [[notion:page:b|B]]",
      new Map([
        ["a", "Resolved A"],
        ["b", "Resolved B"]
      ])
    );
    expect(out).toBe("[[Resolved A]] and [[Resolved B]]");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm --filter @zk/api test notion-mentions`
Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/notion/mentions.ts`**

```ts
const MENTION_RE = /\[\[notion:page:([^|\]]+)\|([^\]]+)\]\]/g;

export function extractMentionIds(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const id = m[1]?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function rewriteMentions(
  body: string,
  titleByPageId: Map<string, string>
): string {
  return body.replace(MENTION_RE, (_match, id, label) => {
    const idStr = (id as string).trim();
    const title = titleByPageId.get(idStr) ?? (label as string).trim();
    return `[[${title}]]`;
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test notion-mentions`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): Notion mention extraction and wikilink rewriting"
```

---

## Task 8: Import orchestration (preview + commit)

Glue: walk a Notion database, fetch each page's body, count inbound mentions (for the typer), produce a `PreviewPage[]`, and (on commit) idempotently insert notes into the DB.

**Files:**
- Create: `apps/api/src/notion/import.ts`
- Create: `apps/api/tests/notion-import.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/notion-import.test.ts
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@zk/db-schema";
import type { NotionClient } from "../src/notion/client";
import { buildPreview, commitImport } from "../src/notion/import";

const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://zk:zk@localhost:5433/zettel_test";
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

function makeFakeClient(pages: {
  id: string;
  title: string;
  properties?: Record<string, unknown>;
  blocks: { type: string; [key: string]: unknown }[];
}[]): NotionClient {
  return {
    async listDatabasePages() {
      return pages.map((p) => ({
        id: p.id,
        properties: {
          ...(p.properties ?? {}),
          Name: { type: "title", title: [{ plain_text: p.title }] }
        }
      }));
    },
    async listBlockChildren(pageId: string) {
      const page = pages.find((p) => p.id === pageId);
      return page ? page.blocks : [];
    }
  };
}

describe("buildPreview", () => {
  it("returns a row per Notion page with detected type and body", async () => {
    const client = makeFakeClient([
      {
        id: "abc-1234",
        title: "A Page",
        blocks: [
          { type: "paragraph", paragraph: { rich_text: [{ plain_text: "body text" }] } }
        ]
      }
    ]);
    const preview = await buildPreview(client, "db-id");
    expect(preview.pages).toHaveLength(1);
    expect(preview.pages[0]!.notionPageId).toBe("abc-1234");
    expect(preview.pages[0]!.title).toBe("A Page");
    expect(preview.pages[0]!.detectedType).toBe("fleeting"); // short body, no signals
    expect(preview.pages[0]!.body).toContain("body text");
  });

  it("counts inbound mentions for typing", async () => {
    const client = makeFakeClient([
      {
        id: "topic-page",
        title: "Topic",
        blocks: []
      },
      // 6 pages all mention topic-page in their bodies → topic gets typed as topic
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `linker-${i}`,
        title: `Linker ${i}`,
        blocks: [
          {
            type: "paragraph",
            paragraph: {
              rich_text: [
                { plain_text: "see " },
                {
                  type: "mention",
                  mention: { type: "page", page: { id: "topic-page" } },
                  plain_text: "Topic"
                }
              ]
            }
          }
        ]
      }))
    ]);
    const preview = await buildPreview(client, "db-id");
    const topic = preview.pages.find((p) => p.notionPageId === "topic-page");
    expect(topic?.detectedType).toBe("topic");
  });
});

async function clearDb() {
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import("drizzle-orm")).sql`TRUNCATE TABLE note_source, highlight, source, spaced_review, note_tag, note_link, tag, note RESTART IDENTITY CASCADE` as any
  );
}

describe("commitImport", () => {
  it("inserts notes idempotently keyed by notion_page_id", async () => {
    await clearDb();
    const pages = [
      {
        notionPageId: "abc-1234",
        title: "A Page",
        body: "hello",
        type: "permanent" as const
      }
    ];

    const r1 = await commitImport(db, pages);
    expect(r1.inserted).toBe(1);
    expect(r1.updated).toBe(0);

    const r2 = await commitImport(db, pages);
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(1);

    const rows = await db.select().from(schema.notes);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.notionPageId).toBe("abc-1234");
    expect(rows[0]!.type).toBe("permanent");
  });

  it("rewrites notion mentions to [[Title]] using the import set", async () => {
    await clearDb();
    const pages = [
      {
        notionPageId: "target-id",
        title: "Target Page",
        body: "I am the target.",
        type: "permanent" as const
      },
      {
        notionPageId: "source-id",
        title: "Source Page",
        body: "See [[notion:page:target-id|Target Page]] for more.",
        type: "permanent" as const
      }
    ];
    await commitImport(db, pages);
    const rows = await db.select().from(schema.notes);
    const source = rows.find((r) => r.notionPageId === "source-id");
    expect(source?.bodyMd).toBe("See [[Target Page]] for more.");
  });

  it("falls back to the embedded label when a mention target isn't in the import set", async () => {
    await clearDb();
    const pages = [
      {
        notionPageId: "orphan-source",
        title: "Source",
        body: "See [[notion:page:unknown-id|Fallback Label]] for more.",
        type: "permanent" as const
      }
    ];
    await commitImport(db, pages);
    const rows = await db.select().from(schema.notes);
    expect(rows[0]!.bodyMd).toBe("See [[Fallback Label]] for more.");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `pnpm --filter @zk/api test notion-import`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/notion/import.ts`**

```ts
import { eq } from "drizzle-orm";
import { notes } from "@zk/db-schema";
import type { NotionClient, NotionPage } from "./client";
import { blocksToMarkdown } from "./blocks-to-markdown";
import { detectType, type NoteType } from "./typer";
import { extractMentionIds, rewriteMentions } from "./mentions";

export interface PreviewPage {
  notionPageId: string;
  title: string;
  body: string;
  detectedType: NoteType;
}

export interface Preview {
  pages: PreviewPage[];
}

function readTitle(page: NotionPage): string {
  const properties = (page?.properties ?? {}) as Record<
    string,
    {
      type?: string;
      title?: { plain_text?: string }[];
      rich_text?: { plain_text?: string }[];
    }
  >;
  // Title properties: convention is named "Name" or "Title"; fall back to any
  // property of type "title".
  for (const key of Object.keys(properties)) {
    const p = properties[key]!;
    if (p.type === "title" && p.title?.length) {
      return p.title.map((t) => t.plain_text ?? "").join("").trim() || "Untitled";
    }
  }
  return "Untitled";
}

export async function buildPreview(
  client: NotionClient,
  databaseId: string
): Promise<Preview> {
  const pages = await client.listDatabasePages(databaseId);

  // Phase 1: fetch every page body and extract its mention targets.
  const intermediate: {
    page: NotionPage;
    title: string;
    body: string;
    mentionIds: string[];
  }[] = [];
  for (const p of pages) {
    const blocks = await client.listBlockChildren(p.id);
    const body = blocksToMarkdown(blocks);
    intermediate.push({
      page: p,
      title: readTitle(p),
      body,
      mentionIds: extractMentionIds(body)
    });
  }

  // Phase 2: count inbound mentions per Notion page id.
  const inbound = new Map<string, number>();
  for (const i of intermediate) {
    for (const id of i.mentionIds) {
      inbound.set(id, (inbound.get(id) ?? 0) + 1);
    }
  }

  // Phase 3: type each page using its inbound count and body length.
  const previewPages: PreviewPage[] = intermediate.map((i) => ({
    notionPageId: (i.page as { id: string }).id,
    title: i.title,
    body: i.body,
    detectedType: detectType(i.page, {
      inboundMentions: inbound.get((i.page as { id: string }).id) ?? 0,
      bodyLength: i.body.length
    })
  }));

  return { pages: previewPages };
}

export interface CommitInputPage {
  notionPageId: string;
  title: string;
  body: string;
  type: NoteType;
}

export interface CommitResult {
  inserted: number;
  updated: number;
}

export async function commitImport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  pages: CommitInputPage[]
): Promise<CommitResult> {
  // Build the title-by-id map up front so mention rewriting in the body has
  // access to every imported title.
  const titleByPageId = new Map<string, string>();
  for (const p of pages) titleByPageId.set(p.notionPageId, p.title);

  let inserted = 0;
  let updated = 0;

  await db.transaction(async (tx: typeof db) => {
    for (const p of pages) {
      const rewrittenBody = rewriteMentions(p.body, titleByPageId);
      const bodyMd = p.type === "topic" ? null : rewrittenBody;

      const [existing] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(eq(notes.notionPageId, p.notionPageId));

      if (existing) {
        await tx
          .update(notes)
          .set({
            title: p.title,
            type: p.type,
            bodyMd,
            updatedAt: new Date()
          })
          .where(eq(notes.id, existing.id));
        updated++;
      } else {
        await tx.insert(notes).values({
          type: p.type,
          title: p.title,
          bodyMd,
          notionPageId: p.notionPageId
        });
        inserted++;
      }
    }
  });

  return { inserted, updated };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zk/api test notion-import`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): Notion import orchestration (buildPreview + commitImport)"
```

---

## Task 9: API endpoints — `/api/notion/preview` and `/api/notion/commit`

**Files:**
- Create: `apps/api/src/routes/notion.ts`
- Modify: `apps/api/src/server.ts` — mount the route

- [ ] **Step 1: Create `apps/api/src/routes/notion.ts`**

```ts
import { Hono } from "hono";
import { Client } from "@notionhq/client";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/client";
import { zodErrorHook } from "../lib/zod-error-hook";
import { makeNotionClient } from "../notion/client";
import { buildPreview, commitImport } from "../notion/import";

export const notionRoute = new Hono();

const PreviewRequest = z.object({
  token: z.string().min(1),
  databaseId: z.string().min(1)
});

notionRoute.post(
  "/preview",
  zValidator("json", PreviewRequest, zodErrorHook),
  async (c) => {
    const { token, databaseId } = c.req.valid("json");
    const client = makeNotionClient(new Client({ auth: token }));
    const preview = await buildPreview(client, databaseId);
    return c.json(preview);
  }
);

const NoteTypeEnum = z.enum([
  "fleeting",
  "literature",
  "permanent",
  "topic"
]);

const CommitPage = z.object({
  notionPageId: z.string(),
  title: z.string(),
  body: z.string(),
  type: NoteTypeEnum
});

const CommitRequest = z.object({
  pages: z.array(CommitPage)
});

notionRoute.post(
  "/commit",
  zValidator("json", CommitRequest, zodErrorHook),
  async (c) => {
    const { pages } = c.req.valid("json");
    const result = await commitImport(db, pages);
    return c.json(result);
  }
);
```

- [ ] **Step 2: Mount in `apps/api/src/server.ts`**

Read the file. Add to imports:

```ts
import { notionRoute } from "./routes/notion";
```

Add an `app.route` line near the other mounts:

```ts
app.route("/api/notion", notionRoute);
```

- [ ] **Step 3: Run tests + typecheck**

```bash
pnpm --filter @zk/api typecheck
pnpm --filter @zk/api test
```

Both clean — no new tests in this task, but everything that was passing still passes.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat(api): /api/notion/preview and /api/notion/commit routes"
```

---

## Task 10: Web — API client methods + import route

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/routes/__root.tsx` — nav link
- Create: `apps/web/src/components/NotionImportPreview.tsx`
- Create: `apps/web/src/routes/import.notion.tsx`

- [ ] **Step 1: Add API client methods to `apps/web/src/lib/api-client.ts`**

Read the file. After `getGraph`, add:

```ts
notionPreview(token: string, databaseId: string): Promise<{
  pages: {
    notionPageId: string;
    title: string;
    body: string;
    detectedType: "fleeting" | "literature" | "permanent" | "topic";
  }[];
}> {
  return request("/api/notion/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, databaseId })
  });
},

notionCommit(pages: {
  notionPageId: string;
  title: string;
  body: string;
  type: "fleeting" | "literature" | "permanent" | "topic";
}[]): Promise<{ inserted: number; updated: number }> {
  return request("/api/notion/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pages })
  });
}
```

- [ ] **Step 2: Create `apps/web/src/components/NotionImportPreview.tsx`**

```tsx
import { useState } from "react";

type NoteType = "fleeting" | "literature" | "permanent" | "topic";

interface PreviewPage {
  notionPageId: string;
  title: string;
  body: string;
  detectedType: NoteType;
}

interface NotionImportPreviewProps {
  initialPages: PreviewPage[];
  onCommit: (
    pages: {
      notionPageId: string;
      title: string;
      body: string;
      type: NoteType;
    }[]
  ) => void;
  committing: boolean;
}

const TYPES: NoteType[] = ["fleeting", "literature", "permanent", "topic"];

export function NotionImportPreview({
  initialPages,
  onCommit,
  committing
}: NotionImportPreviewProps) {
  const [types, setTypes] = useState<Map<string, NoteType>>(
    () => new Map(initialPages.map((p) => [p.notionPageId, p.detectedType]))
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const setRowType = (id: string, type: NoteType) => {
    setTypes((m) => {
      const next = new Map(m);
      next.set(id, type);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkSet = (type: NoteType) => {
    if (selected.size === 0) return;
    setTypes((m) => {
      const next = new Map(m);
      for (const id of selected) next.set(id, type);
      return next;
    });
  };

  const submit = () => {
    onCommit(
      initialPages.map((p) => ({
        notionPageId: p.notionPageId,
        title: p.title,
        body: p.body,
        type: types.get(p.notionPageId) ?? p.detectedType
      }))
    );
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
        <span style={{ color: "#888", fontSize: 12 }}>
          {selected.size} selected
        </span>
        <span style={{ color: "#666", fontSize: 12 }}>Bulk set to:</span>
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => bulkSet(t)}
            disabled={selected.size === 0}
            style={{ fontSize: 12, padding: "2px 8px" }}
          >
            {t}
          </button>
        ))}
        <button
          onClick={submit}
          disabled={committing}
          style={{ marginLeft: "auto" }}
        >
          {committing ? "Importing…" : `Import ${initialPages.length} pages`}
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#888", fontSize: 11 }}>
            <th style={{ padding: 4 }}></th>
            <th style={{ padding: 4 }}>Title</th>
            <th style={{ padding: 4 }}>Type</th>
            <th style={{ padding: 4 }}>Body preview</th>
          </tr>
        </thead>
        <tbody>
          {initialPages.map((p) => (
            <tr
              key={p.notionPageId}
              style={{ borderTop: "1px solid #222" }}
            >
              <td style={{ padding: 4 }}>
                <input
                  type="checkbox"
                  checked={selected.has(p.notionPageId)}
                  onChange={() => toggleSelected(p.notionPageId)}
                />
              </td>
              <td style={{ padding: 4 }}>{p.title}</td>
              <td style={{ padding: 4 }}>
                <select
                  value={types.get(p.notionPageId) ?? p.detectedType}
                  onChange={(e) =>
                    setRowType(p.notionPageId, e.target.value as NoteType)
                  }
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ padding: 4, color: "#888" }}>
                {p.body.slice(0, 120).replace(/\n+/g, " ")}
                {p.body.length > 120 ? "…" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/routes/import.notion.tsx`**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api-client";
import { NotionImportPreview } from "../components/NotionImportPreview";

export const Route = createFileRoute("/import/notion")({
  component: NotionImportPage
});

function NotionImportPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [databaseId, setDatabaseId] = useState("");

  const previewMutation = useMutation({
    mutationFn: () => api.notionPreview(token, databaseId)
  });

  const commitMutation = useMutation({
    mutationFn: api.notionCommit,
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["notes"] });
      await qc.invalidateQueries({ queryKey: ["inbox"] });
      alert(
        `Imported ${result.inserted} new notes, updated ${result.updated} existing.`
      );
      navigate({ to: "/" });
    }
  });

  return (
    <div>
      <h2>Import from Notion</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        Paste a Notion integration token and a database ID. The token is used for
        one request and is not stored.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="password"
          placeholder="Notion integration token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          style={{ flex: 2 }}
          autoComplete="off"
        />
        <input
          placeholder="Database ID"
          value={databaseId}
          onChange={(e) => setDatabaseId(e.target.value)}
          style={{ flex: 2 }}
        />
        <button
          onClick={() => previewMutation.mutate()}
          disabled={
            !token || !databaseId || previewMutation.isPending
          }
        >
          {previewMutation.isPending ? "Fetching…" : "Preview"}
        </button>
      </div>

      {previewMutation.isError && (
        <p style={{ color: "#f7768e" }}>
          Failed to fetch preview: {String(previewMutation.error)}
        </p>
      )}

      {previewMutation.data && (
        <NotionImportPreview
          initialPages={previewMutation.data.pages}
          onCommit={(pages) => commitMutation.mutate(pages)}
          committing={commitMutation.isPending}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add an "Import" link to `apps/web/src/routes/__root.tsx`**

Read the file. Find the header. Add an Import link next to Inbox and Graph:

```tsx
<Link to="/inbox" style={{ fontSize: 14, color: "#7aa2f7" }}>
  Inbox
</Link>
<Link to="/graph" style={{ fontSize: 14, color: "#7aa2f7" }}>
  Graph
</Link>
<Link to="/import/notion" style={{ fontSize: 14, color: "#7aa2f7" }}>
  Import
</Link>
```

- [ ] **Step 5: Regenerate the route tree**

Run `pnpm --filter @zk/web dev` briefly to let the TanStack Router plugin pick up the new file:

```bash
pnpm --filter @zk/web dev &
DEV_PID=$!
sleep 8
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
```

- [ ] **Step 6: Typecheck + tests**

```bash
pnpm --filter @zk/web typecheck
pnpm --filter @zk/web test
```

Both clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): /import/notion route with preview and bulk re-typing"
```

---

## Task 11: End-to-end verification + README

- [ ] **Step 1: Full workspace test**

Run: `pnpm test`
Expected counts:
- shared: 22
- api: ~110 (85 baseline + 3 notion-client + 7 notion-typer + 7 notion-blocks + 7 notion-mentions + 5 notion-import)
- web: 9
- mirror: 14
- readwise: 7 (6 + 1 new update-on-resync)
- **Total ~162**

- [ ] **Step 2: Workspace typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional, requires a Notion integration token)**

```bash
pnpm db:up
pnpm --filter @zk/api db:migrate
pnpm dev:api    # terminal 1
pnpm dev:web    # terminal 2
```

In the browser at `http://localhost:5173/import/notion`:
1. Paste a Notion integration token (https://www.notion.so/my-integrations) and a database ID
2. Click Preview — table appears with auto-detected types
3. Bulk-select rows, set their type, drill into individual rows as needed
4. Click Import — alert shows N inserted, M updated; redirected to home
5. Re-run Import with the same token + dbId — alert shows 0 inserted, N updated (idempotent)

- [ ] **Step 4: Update `README.md`**

Find "Current status" and replace with:

```markdown
## Current status

**M1 feature-complete.** The stack supports note + link + tag CRUD, a CodeMirror 6 markdown editor with `[[wikilink]]` autocomplete, a backlinks panel, inline tag editing, a ⌘K command palette over Postgres FTS, a Sigma.js graph view, a triage inbox with spaced-repetition daily review and Readwise-highlight promotion, a markdown mirror worker that writes every note to `~/Notes/zettel/` with git auto-commits, a Readwise sync worker, and a one-time Notion importer at `/import/notion`. Next phases: M2 (canvases + manuscripts), M3 (local ML).
```

The "Layout" section doesn't need changes — the Notion importer lives inside `apps/api` (described in the architecture); no new top-level package was created. Just confirm the Layout section still accurately describes what's there.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update readme for M1 Plan 6 completion (M1 feature-complete)"
```

---

## Verification checklist (final, post-implementation)

- [ ] `pnpm test` passes (~162 tests)
- [ ] `pnpm -r typecheck` is clean
- [ ] `apps/mirror` no longer lists `@zk/shared` as a dep
- [ ] `apps/readwise` `runSync` updates existing highlights when the source text changes (not insert-only)
- [ ] `POST /api/notion/preview` returns a pages array with detected types and bodies
- [ ] `POST /api/notion/commit` idempotently inserts notes keyed by `notion_page_id`; re-running updates rather than duplicating
- [ ] `/import/notion` UI renders, supports per-row type changes and bulk re-typing
- [ ] Notion `@page` mentions in imported bodies become `[[Target Title]]` wikilinks resolved against the import set

---

## What's deliberately NOT in this plan

- **Re-runnable import with delta-only updates** — the current `commit` updates all pages it receives. If you re-import a 1000-page database, all 1000 rows get an `updatedAt` bump. Add a content hash check in a polish pass.
- **Import progress UI** — preview fetch and commit are synchronous waits with spinners. For large databases (>500 pages), a streaming progress bar would be nicer. Defer.
- **Tag import** — Notion pages often have a `Tags` multi-select property. The plan skips importing tags; user can re-tag in the zettelkasten directly. Worth adding in a follow-up if it turns out to matter.
- **Source/highlight import from Notion** — the spec only describes the Readwise pipeline for sources. If a Notion page has a `Source` property, it's currently detected as a literature note but the source itself isn't imported as a `source` row. The user can manually link via the existing source UI (deferred).
- **Subpage / nested-database import** — the importer only walks the pages directly in the database; nested DBs are not recursed.
- **Image / file attachment import** — Notion blocks like `image`, `file`, `embed` are emitted as `<!-- unsupported block: ... -->` comments. Assets aren't downloaded.
- **OAuth flow** — the user pastes a raw integration token. For a single-user local app this is fine; adding a Notion OAuth dance would be premature.

These are non-blocking, deliberate deferrals.
