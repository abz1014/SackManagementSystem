# Building the IFL SMS User & IT Guide

This folder holds the source and the toolchain for
`IFL-SMS-User-and-IT-Guide.docx` / `.pdf`. Nothing here talks to the plant,
the demo, or any database; it only turns markdown files into a Word document
and a PDF.

## Layout

```
docs/guide/
  src/            chapter markdown, order.txt, meta.json  (T6/T9 write chapters here)
  images/         screenshots and diagrams (PNG), referenced from the markdown (T7/T8/T4)
  facts/          the single source of truth for labels/commands/paths/redaction (T2 owns this)
  build/          the pipeline scripts (this task, T3)
    build_docx.py       markdown -> .docx (python-docx)
    word_finish.ps1     Word COM: update TOC/fields, export PDF
    checks.py           labels/commands/paths/redaction/images checks
    check_labels.py     (T2's) verifies each LABELS.md row against its cited source
    make_placeholder_png.py  generates a throwaway PNG for pipeline smoke-tests
  build.ps1       the one command that runs the whole pipeline
  out/            build output: the .docx, the .pdf, check-report.md (gitignored contents)
```

## Normal build

From the repo root, or from `docs/guide/`:

```powershell
docs\guide\build.ps1
```

This:
1. Renders every chapter listed in `docs/guide/src/order.txt` into a `.docx`
   (`build/build_docx.py`).
2. Opens that `.docx` in Word via COM, updates the Table of Contents and
   every field (including the header/footer page numbers), repaginates,
   updates the TOC a second time so its page numbers match the final
   pagination, saves, and exports a PDF with heading bookmarks
   (`build/word_finish.ps1`).
3. Runs `build/checks.py` against the chapter sources AND the text of the
   final `.docx` (`build/checks.py`).
4. If there is no FAIL-level issue, copies both files to
   `%USERPROFILE%\Desktop\SMS-Guide\` (created if missing).

If any step fails, the build stops there — nothing partial is copied to the
Desktop. Word is only ever driven invisibly (`Visible=$false`); if Word COM
itself cannot be started (activation, first-run prompt, non-interactive
session), `word_finish.ps1` reports the error and **the script does not
install or try any fallback** (no pandoc, no LibreOffice). Report that to the
owner and stop.

## Draft build

```powershell
docs\guide\build.ps1 -Draft
```

Draft mode:
- lets `[[TBD: ...]]` markers through instead of failing the build (they
  still render on the page, in bold red, so they are visible and searchable);
- turns a **missing** `facts/*.md` file (not yet written by worker T2) from a
  FAIL into a WARN in `checks.py`, so chapters can be drafted before every
  fact file exists;
- does **not** relax anything else. A real bad label, a path that isn't in
  the package, a denylisted word, or a broken `{{ref:...}}` still fails the
  build even with `-Draft`.

Use `-Draft` while writing chapters; drop it for the real, final build
(Wave 5's `T10`).

## Content-source rules (what a chapter author writes)

Chapters are `docs/guide/src/NN-name.md`, listed in build order, one per
line, in `docs/guide/src/order.txt` (`#` comments and blank lines ignored).
Cover-page facts (title, customer, classification, date) come from
`docs/guide/src/meta.json`; the version number is always read live from
`sms/package.json`, never typed by hand.

| Write this | Get this |
|---|---|
| `# Heading` / `## Heading` / `### Heading` | Auto-numbered 1 / 1.1 / 1.1.1. Never type the number yourself. |
| `# Heading {appendix}` | Starts (or continues) the lettered appendix sequence: A, A.1, B, B.1, ... |
| `# Heading {unnumbered}` | An unnumbered front-matter heading (and its `##`/`###` sub-headings). It takes no number and does not use one up, so the next numbered `#` is still chapter 1. Not for `{{ref:}}` targets. |
| `## Heading {#some-id}` | Gives that heading an id for cross-references. |
| `{{ref:some-id}}` | Renders as `section 8.2` (whatever that heading's live number is). |
| `[[Label]]` | Renders **bold**. Must be an exact `exact text` value in `facts/LABELS.md`, or `checks.py` fails the build. |
| `[[TBD: note to self]]` | Renders in bold red. Fails the build unless `-Draft`. |
| `1.` / `1.` / `1.` (repeat `1.` on every line) | Auto-numbered steps (1, 2, 3, ...). |
| `- [ ] item` | A ☐ tick-box line. |
| `- item` | A plain bullet. |
| ` ```cmd `, ` ```powershell `, ` ```sql `, ` ```text ` fenced block | Shaded, one-cell, Consolas 9pt command/output box. `cmd`/`powershell` lines are also checked against `facts/COMMANDS.md`. |
| `![caption](../images/S02.png)` | Inserts the picture at 16 cm wide, with an auto-numbered "Figure N — caption" beneath it. |
| Pipe table (`\| a \| b \|`) | A Word table, grid style, bold header row. |
| `> **Note:** ...` | A shaded blue Note callout. |
| `> **Warning:** ...` | A shaded amber Warning callout. |
| `<!-- pagebreak -->` | A hard page break. |
| `` `inline code` `` | Monospace inline run. |
| `**bold**` | Bold inline run. |

Only labels from `facts/LABELS.md`, only commands from `facts/COMMANDS.md`,
only paths from `facts/package-manifest.txt` / the build-output list /
`facts/REDACTION.md`'s placeholders — `checks.py` enforces all three, plus
redaction and image cross-referencing. See "Running checks on their own"
below to iterate quickly.

## Running checks on their own

```powershell
python docs\guide\build\checks.py
```

Writes `docs/guide/out/check-report.md` and prints the same report to the
console. Exits non-zero on any FAIL. Useful while drafting, without paying
for a full Word/PDF round trip. Add `--draft` to soften "facts file doesn't
exist yet" to a WARN.

`checks.py` never writes under `docs/guide/facts/` — that folder is worker
T2's. If you need to point it at a different facts/src/images directory (for
example while smoke-testing the pipeline itself, see below), use
`--facts-dir`, `--src-dir`, `--images-dir`.

## Smoke-testing the pipeline itself (not the real guide)

`docs/guide/src/_sample.md` and `docs/guide/src/_sample-appendix.md` exist
**only** to exercise every piece of markdown syntax above; they are never
listed in the real `order.txt` and must never ship. To use them:

1. Generate a throwaway image (nothing under `docs/guide/images/` should be
   a placeholder in the real build):
   ```powershell
   python docs\guide\build\make_placeholder_png.py docs\guide\images\PLACEHOLDER.png
   ```
2. Temporarily list the two sample files in `docs/guide/src/order.txt`.
3. Run `docs\guide\build.ps1 -Draft` (draft, because the sample deliberately
   includes a `[[TBD: ...]]` marker and a `[[Username]]` label that only
   exists in the real `facts/LABELS.md` once T2 has written the shared-chrome
   section of it).
4. Read the produced PDF (`docs/guide/out/IFL-SMS-User-and-IT-Guide.pdf`)
   with a PDF-reading tool, page by page, and check the TOC page numbers
   against where each heading actually landed.
5. **Clean up afterwards**: remove the two sample lines from `order.txt`,
   delete `docs/guide/images/PLACEHOLDER.png`, and delete the test
   `.docx`/`.pdf`/`check-report.md` from `docs/guide/out/` (or, if you copied
   them to the Desktop while testing, pass a throwaway `-DesktopDir` so the
   real `Desktop\SMS-Guide\` is never touched by a test run:
   `build.ps1 -Draft -DesktopDir $env:TEMP\sms-guide-test`).

## Known limitations of this pipeline

- **Not a full CommonMark implementation.** The parser in `build_docx.py` is
  a small, line-oriented parser for exactly the syntax table above. Nested
  lists, inline links, and multi-paragraph list items are not supported —
  keep chapter markdown to the documented subset.
- **Numbered-list continuation relies on Word's built-in "List Number"
  style** picking up its own shared numbering definition across consecutive
  paragraphs. This was verified working in the sample build (steps rendered
  1, 2, 3 correctly) but has not been stress-tested against a numbered list
  that is interrupted by a non-list paragraph and then resumed — if that
  pattern is needed, verify the rendered PDF renumbers as expected.
- **`checks.py`'s label/command/path checks are pragmatic pattern-matchers,
  not a formal grammar.** They are deliberately lenient about markdown table
  formatting in `facts/*.md` (header names are matched by keyword, not an
  exact schema) so that reasonable variations in worker T2's tables still
  parse. A `facts/*.md` file that is very differently structured from the
  examples described in the plan may need `checks.py`'s table parsing
  adjusted.
- **The path check is a heuristic.** It only inspects `cmd`/`powershell`/
  `sql`/`text` fenced code blocks (not prose) for path-shaped tokens, using a
  regex that stops at whitespace — a path containing a space (for example
  inside quotes) is only partially matched. This is intentionally
  conservative: it will flag more than a perfect parser would, not less.
- **Word COM must be exercised on the machine that will run the real build.**
  This was smoke-tested successfully on this host (Word opened invisibly,
  updated the TOC/fields, exported a bookmarked PDF, and quit cleanly,
  leaving a pre-existing, separate WINWORD window belonging to the signed-in
  user completely untouched). It has not been tested on a different machine,
  a machine where Word has never been activated, or a machine running the
  build non-interactively (e.g. a scheduled task with no logged-in session)
  — Word COM automation is known to be unreliable in that last case.
- **`ExportAsFixedFormat`'s `CreateBookmarks` option only bookmarks headings**
  (`wdExportCreateHeadingBookmarks`), which is what "PDF export end to end"
  needs for navigation; it does not create a separate bookmark for every
  figure or table.
- **No dependency beyond what was already installed** (`python-docx`
  1.2.0, Word via COM, the Python standard library). If a future chapter
  needs something this pipeline cannot do, that is a scope conversation with
  the owner, not a reason to add a library here.
