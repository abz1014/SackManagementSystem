
On 15 Sep 2026 the owner met Hassan sb (IFL) and relayed answers to the 70-question pack (numbers match `IFL-QUESTIONS-STATUS.md`):

- Q1/Q3: 14 Rieter winders confirmed; **machine = station 1–14** (one concept). Q4: derive the packer count from data (Area literal suggests one).
- Q10: **product limits changeable in admin settings** — no fixed limit; SMS must own editable limits (versioned), not only the PDAS mirror.
- Q12: reject-code meanings are set in settings (Setup › Reject codes) — no predefined list.
- Q19/Q40/Q41/Q43: **the process engineer on the floor** changes products, limits and sack adjustments → one `engineer` role/rank for all writes. PDAS write authority still verbal (Q18) → keep `PDAS_WRITE_ENABLED=false`.
- Q24: sack weight = **total (gross) weight of the sack**.
- Q28: "sack stock per machine" means **sack production per machine by shift/day with all relevant info** — a production report, not a receipts/issues ledger (Q29 was our reading). Sacks carry no machine → report per shift/day/product; per-machine stays dependent (PLC excluded).
- Q30/36: reports must be **beautiful, Excel AND PDF, with graphics**; Q37: no email; Q33/34: every report, daily and per shift; Q35: dashboard = live data + today + shift + machine problems.
- Q44: as soon as possible (10 s polling exists; 18-min acquisition lag is IFL's).
- Q46–48: **recommendation only**, no automatic adjustment; "study the data and tell us" — the statistical advisory + projection is the deliverable; whether it satisfies the RFQ's "AI" line is still to be agreed (never call it AI until then).
- Q51–57: owner is trying to get the **last 6 months** of cone and sack data → the archive-ingest path (July shape, non-displacing archive generations, chronological ordinals) must be built before it arrives.
- Q63 + PLC: **no PLC communication or automation** — Phase 2B closed.
- Hardware: **the owner supplies a PC with the software installed** (Q65–70).
- **Key requirement (Hassan's example):** at the morning shift machine 1 ran product A; the engineer changes the product in the database through the software so the evening shift runs product B; reports must show, per machine, which product ran in which shift, and a **separate product-by-machine-by-shift report** is wanted. Design: actual from readings' MaterialId (since 5 Aug) + a declared per-machine changeover recorded in SMS (audited, engineer rank) + declared-vs-actual on the report. Open with the owner: does the PLC take the product from PDAS's active flag or from the machine HMI?

**How to apply:** treat these as IFL's requirement; remove "IFL has not confirmed" caveats they resolve (Q3, Q12, Q24); build the engineer role, SMS-owned limits, per-machine changeover + report, sack production report, Excel/PDF reports (a dependency decision — ask the owner), archive ingest. See [[project-sms-roadmap-execution]], [[project-sms-decisions-pending]].
