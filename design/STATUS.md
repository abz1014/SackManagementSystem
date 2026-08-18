# UI rework — status

The design in this folder is being rebuilt inside `sms/web`. `README.md` is the
handoff; `SMS Rework.dc.html` is the reference prototype. Build against
`SMS Rework.dc.html` only — Directions B and C are rejected alternatives kept
for context.

## Done

| Screen | Route | Notes |
|---|---|---|
| Overview | `?v=dashboard` | 24h run/stop ribbon, KPI cards, findings, cones-by-shift |
| Weight | `?v=weight&sub=spread\|stability` | verdict banner, histogram + stations, X̄ chart, Show-the-maths |
| Output | `?v=performance&sub=oee\|stops\|patterns` | dark OEE block, 7-day strip, loss buckets |
| Rejects | `?v=rejects&sub=reasons\|trend\|station` | count cards, Pareto, p-chart, fix-this-first card |
| Shifts | `?v=shift&sub=week\|all` | three shift cards, three-series trend |
| Records | `?v=register&sub=cone\|sack\|reject` | filter chips, table, sticky detail rail |

## Remaining

- **Setup** — People / Stations / Rules / Sync. Spec in `README.md` §8.
  The Rules panel is where Q4/Q5 (gross vs net) becomes a visible toggle.
- **Login** — spec in `README.md` §1. Near-static; no live data needed.

## The one rule this rework runs on

**Every verdict sentence is computed, never transcribed.** The prototype's copy
quotes fixed numbers that are wrong for this plant, and each one was replaced by
a derived value. Confirmed wrong so far:

- "Night runs 15% behind the other two" — night is the STRONGEST shift here;
  morning is weakest on cones, rejects, availability and OEE.
- "Night has trailed for 18 days straight" — morning trailed 12 of 20 days.
- "The plant's stored value is wrong on 31% of rows" — it is 4.45%.
- "Station 5 is both 24 g light and rejecting 1.9x the line" — no station is
  flagged on both; rejects flag 4 and 5, weight flags 10 and 13.
- "Two inspection codes cause 3 in 4 rejects" — two codes cause 79%.
- "One stop cost more than the other six together" — the longest stop is 16%
  of the day's downtime.
- "Stops cluster at 02:00 and 14:00" — they cluster at 14:00 and 06:00.
- Cpk 0.57 — the real process is capable (1.409 under the current product).
- "+/-12 g action threshold" — it is 2.34 g with no tolerance, 8.00 g with one.

If a sentence states a finding, derive it and let the opposite outcome be
reachable in the code.

## Note for a cloud/remote session

A remote session has the code but NOT the plant database, so it cannot run the
API or verify anything against the 142k rows. That verification loop is what
caught most of the bugs in the reworked screens. Write here; verify on the
machine that has SQL Server.
