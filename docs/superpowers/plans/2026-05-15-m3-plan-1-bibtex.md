# M3 Plan 1: BibTeX export from sources

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** `GET /api/sources/bibtex` returns the entire source table as a BibTeX `.bib` file. A button in the sources list (or manuscript export menu) triggers the download.

**Architecture:** Pure server-side string assembly. Each `source` becomes one BibTeX entry. The author + year drive the citation key (matching the manuscript-export key convention from M2 Plan 4).

**Tech stack:** No new deps. Hono route returns text/x-bibtex.

---

## Tasks

### Task 1: BibTeX serializer
- `apps/api/src/sources/bibtex.ts`
- Function `sourcesToBibtex(sources: SourceRow[]): string`
- For each source:
  - Entry type: `@book` if `isbn` present, `@article` if `sourceType === "article"`, else `@misc`
  - Cite key: `${lastname}-${year}` (lastname = last word of author lowercased, year = 4-digit number extracted from title or "n.d.")
  - Fields: title, author, url (if present), isbn (if present), year (if extracted), note = the original source id (for traceability)
  - Escape special chars: `{`, `}`, `\`, `%`, `&`, `#`, `$`, `_` per BibTeX rules
- Tests: `apps/api/tests/bibtex.test.ts` covering each entry type, escaping, missing-author/year fallbacks
- Commit: `feat(api): bibtex serializer for source table`

### Task 2: Route
- Add to `apps/api/src/routes/sources.ts` (or create if missing)
- `GET /api/sources/bibtex` — returns all sources as `text/x-bibtex; charset=utf-8` with `Content-Disposition: attachment; filename="zettel-bibliography.bib"`
- Tests in `apps/api/tests/sources.test.ts`
- Mount in `server.ts` if new
- Commit: `feat(api): GET /api/sources/bibtex export endpoint`

### Task 3: API client
- Add `bibtexUrl()` to `apps/web/src/lib/api-client.ts` returning the full URL string (since this is a direct download, no fetch wrapping needed)
- Commit: `feat(web): api client bibtex url helper`

### Task 4: Web UI
- Add a "Download .bib" button somewhere appropriate. Options: (a) standalone settings page at `/settings/sources` showing the source count + button, or (b) inline button on `/settings/link-types` page next to a new "Sources" section. Pick (a) for clarity.
- New route `apps/web/src/routes/settings.sources.tsx` → `/settings/sources`
- Show: source count, last-updated timestamp, "Download .bib" button (uses `window.location.href = api.bibtexUrl()`)
- Add `/settings/sources` link to nav
- Component test
- Commit: `feat(web): /settings/sources route with bibtex download`

### Task 5: E2E
- Typecheck + tests
- Commit any cleanup
