# M2 Plan 4: Manuscript exports (Markdown / LaTeX / DOCX)

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** Export a manuscript to Markdown (with citation syntax), LaTeX (via Pandoc-flavored MD intermediate), and DOCX (via Pandoc).

**Architecture:** Pure server-side. Markdown export is template assembly in Node. LaTeX + DOCX rely on Pandoc being installed locally (it's a personal app — assume Pandoc is present; document the requirement in README). The `/api/manuscripts/:id/export?format=md|latex|docx` endpoint streams the file with appropriate `Content-Type` and `Content-Disposition`.

**Tech stack:** Node's `node:child_process` to shell out to Pandoc. No new web deps.

---

## Tasks

### Task 1: Markdown serializer
- `apps/api/src/manuscripts/export-md.ts`
- Function `manuscriptToMarkdown(manuscript, sections, noteByIdMap, sourceByIdMap): string`
- Format:
  ```
  # <title>
  
  <bodyMd if set>
  
  ## <section.heading or note.title or "Section N">
  
  <transcluded note body OR section.frozenBodyMd>
  
  ## References
  
  - [@<source-key>] <title> by <author>
  ```
- Inline citations: for each source referenced by a section's note (via `note_source`), emit `[@<source-key>]` after the section content. Source-key = `lastname-year` (extract from `source.author` first word lowercased + a year if present, else `source.id` slice).
- Tests in `apps/api/tests/export-md.test.ts`
- Commit: `feat(api): manuscript markdown serializer`

### Task 2: Pandoc wrapper
- `apps/api/src/manuscripts/pandoc.ts`
- Function `runPandoc(input: string, args: string[]): Promise<Buffer>`
- Uses `child_process.spawn("pandoc", args, { stdio: ['pipe', 'pipe', 'pipe'] })`, pipes input to stdin, collects stdout, rejects with the stderr text on non-zero exit.
- Detect Pandoc presence at startup with a memoized `isPandocAvailable()` (returns false if `which pandoc` errors). Endpoints return 503 with `{error: "Pandoc not installed"}` when unavailable for latex/docx requests.
- Tests use `child_process` mocks (vitest `vi.mock("node:child_process")`); no real Pandoc invocation in tests.
- Commit: `feat(api): pandoc wrapper for latex/docx export`

### Task 3: Export route
- `apps/api/src/routes/manuscript-exports.ts` (or merge into existing `manuscripts.ts`)
- `GET /api/manuscripts/:id/export?format=md|latex|docx`
- Validates format with Zod (`z.enum(["md", "latex", "docx"])`)
- For md: assembles + returns as `text/markdown; charset=utf-8` with `Content-Disposition: attachment; filename="<slug>.md"`
- For latex: assembles md, pipes to `pandoc -f markdown -t latex --standalone`, returns as `application/x-tex`
- For docx: same input, `pandoc -f markdown -t docx`, returns `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Slug = manuscript title kebab-cased
- Tests in `apps/api/tests/manuscript-exports.test.ts` covering md (real assembly) and latex/docx (mock pandoc to return `Buffer.from("pdf-stub")`)
- Commit: `feat(api): manuscript export endpoint for md/latex/docx`

### Task 4: Web export UI
- Add an "Export" dropdown to ManuscriptView (top-right of center pane): Markdown / LaTeX / DOCX
- Each option does `window.location.href = api(`/api/manuscripts/${id}/export?format=${fmt}`)` — browser handles download
- Show toast/inline message on 503 from latex/docx (Pandoc missing)
- Component test in `apps/web/tests/`
- Commit: `feat(web): manuscript export dropdown in ManuscriptView`

### Task 5: README
- Update README "Current status" + Setup sections to note Pandoc as an optional dependency for manuscript export
- Commit: `docs: pandoc requirement for manuscript exports`

### Task 6: E2E
- `pnpm -r typecheck` clean
- `pnpm -r --workspace-concurrency=1 test` — all green

## Conventions
- Same as prior plans
- Citation generation is deliberately simple — don't over-engineer BibTeX (deferred to M3)
- Server-side rendering of MD is just string assembly, no parsing
