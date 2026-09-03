# Open questions

Six things the design spec deliberately does not answer. Three of them change
code you would otherwise write twice, so they are worth settling before you
start.

Each one below has the context, the options, and a recommendation. **Do not
resolve any of them silently in code.** If you disagree with a recommendation,
say so — several of these are judgement calls, not oversights.

---

## 1. Wall.tsx — the JSX is not written

**Status:** the CSS is complete and final (`.wall`, `.w-head`, `.w-figs`,
`.w-stwrap`, `.w-st`, `.w-foot`). The React component is not.

This is the one screen with real work in it. Everything else in the redesign is
a stylesheet swap plus three small edits.

**What has to change in the component:**

- Station cells become a `.bar` + `.cap` pair instead of a bordered box with the
  number inside. The bar's height is `count ÷ max × 92px`, so the component
  needs the row max — a `Math.max(...stations.map(s => s.cones))` on render,
  with a floor so a single-station shift does not produce one full-height bar
  and thirteen zero-height ones.
- The figure row sits on a shared `1px solid var(--ink)` top rule.
- The footer is a pinned band (`.w-foot`), not the last flex child of the page.
- `.w-stwrap` takes `margin-top:auto`.

**Questions for you:**

- **Do you want me to write it, or would you rather write it against the CSS?**
  The CSS is unambiguous enough that either works.
- **What is the bar-height floor?** My suggestion: never below 4px for a station
  with any cones at all, so "produced something" and "produced nothing" are
  visually distinct. A zero-cone station should be a genuine gap.
- **Should the bar max be the period max, or a fixed expected-throughput
  ceiling?** Period max makes the row self-scaling and readable every shift, but
  it means bar heights are not comparable between two photographs of the wall
  taken on different days. A fixed ceiling is comparable but usually shows
  fourteen short bars. I lean period max, because the board's job is "is anything
  out of line *right now*", not cross-day comparison.

---

## 2. More than 14 stations on the wall

**Status:** unbuilt. Currently `--st-count` drives
`repeat(var(--st-count, 14), minmax(0,1fr))` and the bars just get thinner.

Below about **1.4vw** a bar stops reading as a height at four metres, which is
the entire mechanism. On a 1920 panel with 3.6vw side padding and 0.55vw gaps,
that ceiling is around 16–17 stations.

**Options:**

- **(a) Second bar line.** Two rows of up to 14. Costs vertical space, which the
  pinned footer and the 7.4vw figures are already using.
- **(b) Drop the labels, keep the bars.** Works to maybe 24 stations, but a
  flagged station can no longer be identified from the doorway — which defeats
  the point.
- **(c) Show only the extremes.** The 6 highest and 6 lowest, labelled, with a
  count of the rest. Scales indefinitely but stops being a picture of the line.
- **(d) Refuse.** Cap the wall at 16 and show a Setup warning above that.

**Recommendation: (a), and (d) as the backstop.** The line has 14 stations and no
stated plan to grow. Building (c) now is speculative work against a requirement
nobody has.

**Question for you:** is IFL actually planning to add stations? If not, this is a
`// TODO` with a comment, not a feature.

---

## 3. Urdu labels — the first real exception to the one-typeface rule

**Status:** open, and larger than it looks.

The doctrine's first rule is one typeface. **Instrument Sans has no Arabic
script**, so Urdu labels need a second family — the first legitimate exception
to rule 1 since the redesign began.

**What is involved:**

- A second object in `words.ts` (the strings themselves are the easy part).
- A second font, self-hosted. Noto Nastaliq Urdu is the obvious candidate, but
  Nastaliq is a calligraphic style with **very large ascenders and descenders** —
  it needs roughly 1.6–2× the line height of a Latin face at the same nominal
  size. Every fixed-height element in the app (the 56px strip, the 32px strip,
  `.st-tag`'s reserved 1.4em, the wall's `.cap`) would need checking.
- A type-ramp audit at the same six sizes. `--fs-tick` at 13px is almost
  certainly unreadable in Nastaliq and would need its own floor.
- Numbers: Urdu conventionally uses Eastern Arabic numerals. **Do not switch
  them.** The whole app depends on tabular figures aligning in columns, and the
  plant's own records are in Western digits. Mixing would make the register
  unmatchable against the source data.
- RTL: does the layout mirror, or only the text? The hanging-label grid, the
  right-aligned numeric columns and the right-hand sheet all assume LTR.

**Questions for you:**

- **Is Urdu actually in scope, or aspirational?** This is a substantial piece of
  work — realistically larger than the rest of the redesign combined.
- **Labels only, or full RTL?** Bilingual labels with an LTR layout is perhaps a
  fifth of the work of a mirrored RTL app, and for a plant floor it may be all
  that is wanted.
- If it is in scope, **it deserves its own spec.** Do not attempt it as part of
  this one.

---

## 4. The verdict mark on an exported CSV

**Status:** open. The mark exists on screen and in print. CSV is unresolved.

The verdict mark carries a figure, its period, and who signed for it. A CSV
export of the same report carries the figures and nothing else — so the moment
it leaves the building it is an unattributed spreadsheet, which is exactly the
problem the mark was created to solve.

**Options:**

- **(a) Nothing.** CSV is data for a spreadsheet; provenance lives in the app.
- **(b) A comment header** — three `#`-prefixed lines before the data. Honest,
  but breaks naive parsers and Excel shows them as a mangled first row.
- **(c) Trailing metadata rows** after a blank line. Survives Excel; most
  parsers stop at the blank line.
- **(d) Filename only** — `sms-report-2026-08-28_2026-09-03-araza.csv`. Zero
  format risk, and the filename is the first thing anyone sees. But filenames
  get renamed.

**Recommendation: (d) plus (c).** The filename does the everyday work and the
trailing rows survive for anyone who opens the file properly. **(b) is the one
to avoid** — a mangled first row in Excel is worse than no attribution.

**Question for you:** who receives these CSVs, and do they open them in Excel or
feed them to something?

---

## 5. The three unconfirmed rules

**Status:** still unconfirmed by IFL. This is not a design question — it is a
blocker on the business side that the design currently handles by admitting it.

| Rule | Current value | Consequence of leaving it open |
| --- | --- | --- |
| Weight basis | `as_recorded` | Weight's headline states the average and the target as **two facts** rather than a difference. If they are on opposite bases the comparison is out by a whole tube. |
| Cone tube weight | 70 g | Only applied when basis is net. Inert until the basis is confirmed. |
| Sack tare | 0.5 kg | Same. |

Everything downstream says so out loud, and Setup › Rules labels each one "not
confirmed by IFL". **Keep it that way until someone confirms them in writing.**

All three are interpreted at read time and never baked into stored data, so
confirming one is a settings change and not a re-sync. That is what makes it safe
to ship with them open.

**Question for you:** who at IFL owns this, and is anyone chasing it? The Weight
screen cannot state its most useful finding until it is answered.

---

## 6. The numbers in the spec are invented

**Status:** every figure in both reference pages is fabricated from the config
defaults.

4,182 cones · 116 sacks · 76 rejected · 1.8% · 1,250 g target ·
1,225–1,275 g limits · 45.6 kg sacks · 14 stations · Station 7 reading +9 g ·
Station 9 quiet 34 min · 11,698 cones for the week.

They are internally consistent and plausible, and they are not real.

**Two things follow:**

- **Do not treat any of them as a requirement.** If a real reject rate is 6%, the
  design still works — but Attention will have more to say and the "and 2 more"
  overflow will be the normal case rather than the exception. Worth checking
  against real data early.
- **Swap in real figures before anyone at IFL sees these pages.** A GM who spots
  a wrong number stops reading the design.

One number I would specifically like checked: **the reject reason distribution.**
The spec shows two unnamed codes dominating (812 and 471 of ~1,700). If the real
data is a long tail of thirty codes, the reasons block needs a different
treatment than five bars.

---

## Summary — what I would settle first

| Priority | Question | Why now |
| --- | --- | --- |
| 1 | §1 Wall — write it or not, and the bar-max rule | It is the only real build work; the rest is a CSS swap |
| 2 | §6 Real numbers | Cheap to answer, and it may invalidate a layout assumption |
| 3 | §3 Urdu scope | If it is in scope it changes the type ramp, and the ramp is the foundation of everything else |
| 4 | §5 The three rules | Not yours to fix, but worth knowing who is chasing it |
| 5 | §4 CSV attribution | Small, self-contained, easy to add later |
| 6 | §2 >14 stations | Almost certainly a `// TODO` |
