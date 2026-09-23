# Commissioning gaps — what's missing to install this at IFL

One-minute read. Full evidence: `FRICTION-AUDIT.md`, `VERIFICATION-2026-09-23.md`,
`IFL-OPEN-QUESTIONS.md`. Every line traces to one of those.

## 1. Stops commissioning

- No read-only login/host for the live plant server — nothing can be installed until this arrives → IFL #1
- PC-to-plant network reachability unconfirmed (and which side of a PLC/server split it sits on) → IFL #2
- Cutover has never been rehearsed against an unknown login shape; if IFL's real login is EXECUTE-only on PDAS (the `ibrahim` pattern already seen), the documented clean halt breaks and retries forever → ours
- PDAS write authority contradicts itself in our own records (verbal-only vs. "granted" in a commit message, no document either way) — changeover's final step stays disabled until this is resolved → IFL #3
- Windows service (NSSM) has never been installed or exercised anywhere, on any machine, for either process → ours
- Nightly backup is scheduled only on paper — restore is proven twice, unattended scheduling never run → ours
- 93 commits exist only on this laptop, never pushed, never seen by CI → ours
- No off-machine copy of IFL's data exists — July's 142,511-cone generation is on this one laptop only → ours

## 2. Wrong on screen today

- Reject rate disagrees with itself: Line and Rejects print 3.3%, Report prints 3.4%, same period — client still uses the pre-fix denominator the server already corrected → ours
- Report layer (cone weight, product, station, per-station queries) is not scoped to source generation — any report touching Aug 21 onward silently pools real September readings with simulator readings, no flag shown → ours
- The running API process is stale (predates the latest build) — right now the period picker pools July, real September, and simulator days with no generation warning at all, worse than either audit doc describes → ours
- Machine-product report: ~91% of columns are off-screen with no sticky first column, on the report that answers IFL's own per-machine-per-shift ask → ours
- Product › Running shows a retired product with no "retired" marker, while three reports cite that same product as "the target" → ours

## 3. Built but unproven

- PDF export (real headless-Edge/puppeteer-core pipeline, dependency and Edge binary both present) has never been invoked end to end by anyone, in any test or script → ours
- `sms verify` works cleanly against local copies (0 discrepancies, 16 epochs) but has never run against a live plant login, because none exists yet → IFL #1
- Print/PDF layout is verified only by viewport-resize simulation — no real print dialog or PDF has ever been rendered and inspected → ours
- Viewer (rank 1) role has never been signed into on a live instance — rendering is proven by test harness only, never by a real account → ours

## Honesty block
- Never run against real plant data — every figure above comes from local copies stopping 7 Sep 2026.
- Print/PDF has never actually been rendered — only simulated.
- Viewer rank has never been signed in as, live.

Excluded on purpose: cosmetic polish, refactors (e.g. folding `generationWords.ts` into `words.ts`), guard-test hygiene.
