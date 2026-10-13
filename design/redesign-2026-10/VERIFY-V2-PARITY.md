# VERIFY-V2-PARITY - figure parity of wave 2 and traceability audit (13 Oct 2026, HEAD f65b4ab)

Read-only. Old UI (`/`) and web-next (`/next/`) both built to scratch from HEAD, served by the login-free harness (real `api/dist`, DB `sms_audit` READ_ONLY, render-token identity at rank 1, 2, 3, 4, own ephemeral ports), real Edge via Playwright at 1366x768 (375x812 for one phone check). Non-GET API calls were aborted in the page. No code edited, no account created, nothing written, :4000 and :5173 not touched, no write/Execute/Save/Acknowledge/Retire control clicked. `npx vitest run web-next`: 43 files, 708 tests passed. Filled checklist: `PARITY.md`. Evidence: scratchpad `v2b/shots/`.

## Verdict

PARITY: **PASS with one S3 defect and one S2 gap.** Every figure compared is identical to the old UI: Register (counts for cones, sacks, inspection fails, weight-check fails; 954 first-page rows compared by record id, weight and product, 0 mismatches), the five record sheets, the stock ledger (days, opening, receipts, closing), Products Board / Catalogue / Limits & History / Changeover lists, all 18 report types at PD1, PL and PR (54 pairs, no number missing), Diagnostics, Setup (every old value present), CSV exports (byte-equal apart from the generated-at line), and the wave-1 figures (Today, Weight, Rejects, Stations). Today "Failed weight check (scale)" now reads PL 53 of 132,550 (= `conesFailedScale`), PR 1, PD1 0.
TRACE: **175 non-built rows audited: 163 now built, 12 gap, 9 decision-needed** (below). The matrix is not "all built": the Wall display has no way in, and six guard tests were not ported.

## Mismatches and defects

| id | where | what | severity | explained or defect |
|---|---|---|---|---|
| P1 | Products > Board cards (and the change list) | Product shown as "205-IL0-SD" plus colour only. The blend, count and tube that tell products apart are dropped, so St 3 (Orange, PVSD8020 30) and St 11 (Orange, PVSD8020 20 Slub) read identically; old Running and the new Catalogue show the full label. | S3 | defect (the old Running screen disambiguated six materials sharing one description) |
| P2 | whole app | No control leads to the Wall display (no top-bar button, menu item or Today link). `?s=today&wall=1` works only by typed URL or the legacy `?s=wall` redirect. TRACE A3-007. | S2 | defect (a TV user has no way in) |
| P3 | legacy `?s=report` with no `rt` | Lands on `?s=reports` without `rt=daily` (decision E-1 asked for it); the landing card is Management summary at rank 3. TRACE A6-L13. | S4 | defect |
| P4 | `?s=system&t=setup` at rank 1 to 3 | Silent redirect to Today; the old app says "This is only available to an administrator." | S4 | defect (a typed URL gives no reason) |
| P5 | Diagnostics | The old data-batch table (first seen, registered by, status, rows held per table) is reduced to three summary lines ("Older IFL database 142,511 cones ..."). | S4 | defect or intended simplification, owner to say |
| P6 | fonts | Manrope woff2 not supplied (placeholder css); falls back to self-hosted Instrument Sans. 0 external requests. | S4 | known, waiting on the owner's file |
| P7 | Board | Station 5 is "East Conveyor" on its card but "Station 5" in the Product changes list. | S4 | defect (naming) |
| P8 | Register sheets | Label case changed: "Morning" to "morning", "Not weighed" to "Not weighed" (only first). "1 cones failed" (old too). | S4 | wording |
| P9 | Board, 1366 | Idle and running cards in the 3-column grid have uneven heights; borders of one row touch the next in the screenshot. | S4 | for V2a layout pass |
| X1 | Register times | Old shows minutes ("5:54 AM"), new shows seconds ("05:54:56") and the day. | n.a. | intended |
| X2 | Register status words | "Rejected by the scale" now "Failed weight check (scale)"; "Rejected by inspection" now "Failed inspection". | n.a. | intended (GLOSSARY) |
| X3 | Sack kg on Today | 47.4 vs old 47.34 (one decimal). | n.a. | intended |
| X4 | Today failed weight check | counts the scale bit (53 PL); old report and Rejects tab count reject records (41 PL). Both labelled. | n.a. | explained since wave 1 |
| X5 | Template | `jc=2/1` in the template is not a code value; the format is `2-1`. The filter keeps `2-1`. | n.a. | template error |

Not defects, checked: write controls present or absent exactly by rank (Name it, Log an adjustment, Record a movement, Acknowledge, Retire/Reactivate and limit Edit from rank 2; exports from rank 3; Setup tab only at rank 4; Management summary shows "Needs a manager account" below rank 3); 0 non-local requests; X-3 empty-period sentence present on Today, Weight, Register, cone-weight and machine-product (E-7 met); 375 px bottom bar and scrollWidth 375 on Today.

## TRACE audit (sections A and B)

Statuses set in `TRACE.md` (status column only, evidence in the cell). Before: 175 mapped, 9 decision-needed, 1 gap (185). After: **built 163, gap 12, decision-needed 9, mapped 0**. Wave-2 rows already marked built were not re-checked one by one (marked by home screen); the screens were exercised as above.

Gap list:
- A2-082 `/next` is served (200); root-to-`/next` redirect is a cutover step, not done.
- A3-007 no way into the Wall display from the UI (P2).
- A6-L13 `?s=report` does not write `rt=daily` (P3).
- A7-17 Manrope font file not supplied (P6).
- A7-19 and B6-16 no Playwright layout, print or a11y spec exists for web-next.
- B6-03 reliability guard 1 (every fetch error read) and the rank-comparison list not ported.
- B6-04 no web-next landscape print guard; B6-05 no chart-overlay-hidden-in-print guard.
- B6-06 rank.crosscheck (client rank constants against route `requireRole`) not ported.
- B6-10 missing-field fuzz not ported; B6-11 sheet no-remount test not ported.
- Original row A6-L14 (old sack chart anchors) is built: `?s=weight&wt=sack` and `?s=sacks` land correctly.

## The 9 decision-needed rows, one-line recommendation each

1. A2-084 further API additions: none were needed or added; close as "none", keep the read-time-derivation rule.
2. A3-021 central copy table: accept `web-next/src/copy.ts` as the single table (Urdu pass later).
3. A5-24 "Assumed until IFL confirms" block: keep verbatim; the new reports print it identically to the old ones.
4. B4-07 CSS follow-up outcomes under Style C: accept; re-baseline the specs against web-next (A7-19); "Zoomed in - Back" and the sideways-scroll cue are present.
5. B4-08 owner "no change" decisions: keep all four unless the 860 px breakpoint moved (V2a layout pass to confirm).
6. B6-07 rank matrix: a web-next `rank.matrix.test.tsx` exists; decide that a typed Setup URL below rank 4 shows the old "only available to an administrator" line (P4).
7. B7-2 weight basis wording: keep "weight basis not yet confirmed" (shown on Today and Weight) until IFL answers Q4 and Q5.
8. B7-3 "awaiting IFL's approval" and "IFL has not yet said": keep verbatim (present: 18 on the management summary).
9. B7-4 sack-stock words: keep (Register > Sack stock prints the same wording as the old Sacks screen).

## Not checked

Printing and PDF/XLSX content (CSV only), chart click-zoom and Back in a real browser, fault-injected failed fetches, replay banner, text-size reload, signed-in sessions (render token only), 14 of the 18 per-type export links (same component), write effects (none clicked), per-shift cone counts for PL (chart only), Wall at 1920, phone layouts other than Today at 375, forced-colours, keyboard focus under sticky heads.
