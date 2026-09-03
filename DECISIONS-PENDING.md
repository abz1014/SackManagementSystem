# Decisions pending — SMS

**As of 3 September 2026.** Everything below is built and working; each item is
a judgement call that is **not mine to make**, recorded so it is not lost.

Nothing here blocks a demo. Items 5–9 block **go-live with IFL**.

---

## 1. Two strings were added to `words.ts` — designer to confirm

**Status:** done, and it contradicts one line of the handoff.

The handoff's file table says `web/src/lib/words.ts` — **"No change. No new
strings anywhere."** But two pieces of copy are specified in the same bundle:

| String | Where the bundle asks for it |
|---|---|
| `plantClock` — "plant clock" | §Line: *"Left: 8px dot + 'TP1 · Line 3 · Unit 2 · plant clock 11:26:04'"* |
| `report.verdict` — "Verdict" | The verdict mark's own label in the design reference |

Doctrine rule 7 says every user-visible string lives in `words.ts`, so putting
them there is the compliant way to render specified copy.

**Decide:** keep both (current state), or drop the labels and render a bare
clock and an unlabelled ink block. I recommend keeping them — an unlabelled
second time beside "Readings to 16:39" reads as the same clock, and an
unlabelled ink block does not say what it is.

## 2. Acceptance check 1 cannot pass — designer to restate

**Status:** measured, not fixable in code.

> *"No screen shows more than four of the six type steps."*

Line, Weight, Rejects and Report each measure **six**. Every one is mandated by
the spec's own screen descriptions: a headline (`head`), the three figures
(`display`), their qualifier (`qual`), body sentences (`body`), captions and
block labels (`small`), and axis ticks or station labels (`tick`).

The only avoidable size — a 30px inline on Weight — is gone, replaced by the
`.fig-val.small` class the bundle ships for that case.

**Decide:** relax the check to five or six, or restate it (perhaps "at most
four per *block*", which the app does satisfy).

## 3. Label-less blocks span the full width — designer to confirm

**Status:** as the bundle's own CSS specifies.

`.block.wide` exists with the comment *"A block with no label spans both
columns rather than leaving a 180px hole"* — so the figures row starts at the
page edge while labelled content starts 220px in. That is **two** content left
edges, where acceptance check 4 asks for one.

Forcing the figures into the 830px content column would overflow them: four
totals at `--fs-display` need about 290px each.

**Decide:** keep (current), or accept narrower figures.

## 4. Reject reason names are long because IFL has not named the codes

**Status:** this is open question §6, now answered with real data.

The spec assumed two dominant named reasons. The **real distribution is a
nine-code tail** — top two at 55% and 25% — and because the codes are unnamed
every label reads *"Code 10/1 — not yet named"*, 26 characters, which wraps to
three lines in the half-width reasons column.

It resolves itself the moment IFL supplies the names (item 6). If they never
do, the reasons block wants a different treatment than horizontal bars.

**Decide:** leave as is until IFL answers, or design a narrow-column variant.

---

## 5–9. The five questions for IFL — **not yet sent**

Drafted in `REDESIGN.md` §11. These have long turnarounds and block real
functionality. Send them together.

| # | Question | What it blocks |
|---|---|---|
| 5 | **Sack stock per machine** (`IFL_SACK_STOCK_QUESTION.md`) | Requirement 7 entirely. Their sack table carries no machine and no record of a sack leaving, so it is not computable by anyone. The largest missing module. |
| 6 | **Reject code meanings** | The Rejects screen names codes instead of reasons (item 4 above). |
| 7 | **Is "AI" contractual?** | Whether the calibration advisory needs re-framing. They are non-technical here and simply expect AI in the product. |
| 8 | **Which device, and Urdu?** | The wall is built for 1920×1080. Urdu is a substantial piece of work — Instrument Sans has no Arabic script, so it needs a second family, a type-ramp audit and a decision on RTL. It deserves its own spec. |
| 9 | **Weight basis, gross or net** | The Weight headline **cannot state its most useful finding** until this is answered. Today it states the average and the target as two facts, because on opposite bases the comparison is out by a whole tube. |

**Who at IFL owns item 9, and is anyone chasing it?**

---

## 10. Two open questions I resolved as recommended

Recorded so the decisions are visible, not to reopen them.

- **§1 Wall bar scale** — bar height is `count ÷ period max × 92px`, floored at
  4px so "produced something" and "produced nothing" stay distinct, and zero is
  the only genuine gap. Period max, not a fixed ceiling: the board answers "is
  anything out of line right now", not "how does today compare with Tuesday".
- **§4 CSV attribution** — the filename carries who exported it, and trailing
  rows after a blank line carry the line, period, coverage and exporter. Never
  a comment header: Excel shows that as a mangled first row.
  **Still unanswered: who receives these CSVs, and do they open them in Excel
  or feed them to something?**

## 11. Also outstanding, from the structural redesign

Listed in `REDESIGN.md`. Not part of the visual handoff.

- The role rename to viewer / engineer / manager / admin.
- The app-owned product-details overlay, and a *Product limits* rule in Setup —
  requirement 2 says "defined limits" and there is currently nowhere for IFL to
  define them.
- The per-day-per-code reject reason sheet.
- The station sheet. The spec says *"the adjustment log lives in the station
  sheet"*; that sheet does not exist yet, so the log has no home.
- The line-level sack ledger, once IFL answers item 5.

---

## 12. Two pieces of MY test data are in the app database — your call

**Status:** created during acceptance testing on 3 September 2026, still there.

Both are in the **app-owned** database (`sms`), never IFL's. Neither is a
defect; both are residue I made proving the app works, and deleting rows from
an audit trail is not a call I should make alone.

| What | Where it shows | Why it was created |
|---|---|---|
| A calibration adjustment on **station 7**, reason *"verification test — reference weight checked"* | Weight's station table now reads "Adjusted today, steady since." for station 7, and that station's drift detection has been reset from that moment | To prove the Log-an-adjustment round trip writes, attributes and displays correctly |
| A test account **`floor`** at operator rank | Setup's user list | To prove that roles gate writes only, and that a low rank never meets a 403 |

**Decide:** remove both before the next IFL demo, or keep them. If you want
them gone I can do it — say so and I will; I have not touched them because a
logged calibration adjustment is exactly the kind of record that should not
disappear without the owner saying it may.

## 13. Verification found six defects, all now fixed — nothing pending

Recorded only so the fixes are not mistaken for taste and undone later.

1. **Line's figures ignored the global period** — every period printed the
   current shift's three numbers on the one screen whose question is "what has
   it made this period".
2. **The reject reason labels rendered at ZERO width** between 861 and 1040px,
   painting each reason over its own bar. `.two-col` collapsed at the page's
   860px breakpoint, but its half column stops fitting a reasons row about
   180px earlier. A breakpoint belongs to the narrowest content in the column,
   not to the page.
3. **Neither register could be opened from a keyboard.** Readings and Weight
   build rows as `<tr onClick>` with no tabindex and an aria-hidden chevron, so
   the sheet — the whole drill-down mechanism — was mouse-only. Line was
   already correct, which is how the inconsistency surfaced.
4. **"Adjusted 0 days ago by , steady since."** The string asked for a name the
   row type does not carry, so the comma had nothing before it and never could
   have; and "0 days ago" is how it read for every adjustment logged that day.
5. **The wall's bars were the one dimension not sized in vw**, so on the 2560
   and 3840 panels the stylesheet is explicitly written for, the type doubled
   and the bars did not.
6. **The wall's station row hung from the bottom**, so the one station whose
   name wraps to two lines lifted its own bar 31px above its neighbours' — a
   crooked baseline on the screen read from four metres.
