# IFL questions — what we already know vs. what we still need to ask

**Last brought current: 23 September 2026.** The previous version of this file was dated
11 September 2026 and did not contain IFL's answers of 15 September 2026, although
`handover/contracts/WAVE-F-CONTRACT.md` (item 5) required that it be rewritten with them.
Four project documents depend on this file being true, so nothing below is carried over on
trust: every 15 Sep answer is quoted from `handover/IFL-ANSWERS-2026-09-15.md` and, where
the software already acts on it, the acting code or database row is named.

Question numbers are the **70-question pack** in
`IFL_Hassan_Simple_Requirements_Questions.md`, body sections A–L. **Read the numbering
warning below before quoting any "Q" number to anyone.**

Each item is tagged with where the answer comes from:
- **[IFL said so — 15 Sep 2026]** — Hassan sb, relayed by the project owner from the 15 Sep
  meeting. Recorded in `handover/IFL-ANSWERS-2026-09-15.md`.
- **[IFL said so]** — IFL or their representative stated this directly, on an earlier date,
  named in the entry.
- **[We measured it]** — determined from IFL's own data or documents, never confirmed by IFL
  in words.
- **[Our design]** — not a fact about IFL at all; a choice already built into the software,
  and the "question" is really asking IFL to bless it.

---

## ⚠️ The numbering warning — read before quoting a question number

**Three different numbering schemes are live in this project, and two of them collide.**
This was found by the 15 Sep audit (`AUDIT-2026-09-15.md` finding 36) and is still true
today; it is written here rather than quietly renumbered, because a reply from IFL that
quotes a number has to be routable.

| Scheme | Where it lives | Example of the collision |
|---|---|---|
| **The 70-question pack** (used by THIS file) | `IFL_Hassan_Simple_Requirements_Questions.md` §A–L | Q10 = "who decides the weight limits"; Q24 = "is sack weight gross or net" |
| **The 22-question client questionnaire** | `QUESTIONS.md` (Desktop copy) / `SCHEMA.md` §4 | Q10 = "what do the quality inspection codes mean"; Q4/Q5 = "sack / cone weight — what exactly is measured" |
| **The "MOST IMPORTANT" short list** | `IFL_Hassan_Simple_Requirements_Questions.md`, lines 252-261 | Its own 1-10, unrelated to both of the above |

`CLAUDE.md` and `PROJECT_STATUS.md` §5 mostly use the **22-question** scheme ("weight basis
(Q4/Q5)", "reject-code meanings (Q10)", "KPI approval (Q33-37)" — the last of which is in
fact the 70-pack's numbering, in the same sentence as two from the other scheme). Whenever
this file needs to name one of those, it writes the scheme out in full.

**Two arithmetic errors in the 11 Sep version of this file, corrected here rather than
silently:** its Part 1 heading said "34 of 70" but listed 33 questions; its tally said 36
open but its Part 2 listed 37. 33 + 37 = 70, so the *list* was right and both *counts* were
wrong by one.

---

## Part 1 — Answered

### A. Machines

**1. Fourteen Rieter cone winding machines on TP1 Unit 2 Line 3 — correct?**
**RESOLVED 15 Sep 2026** — yes, 14 Rieter winders, confirmed. *[IFL said so — 15 Sep 2026]*

**2. Does each machine have a unique machine number/name?**
Each machine has a unique number, 1 through 14 (the database column is `MachineNo`, formerly
named `Source`). No name beyond the number has ever come from IFL — that is why the software
has its own local screen for typing in a friendly name per machine. *[We measured it]*

**3. Do machines have stations/spindles/heads needing separate identification?**
**RESOLVED 15 Sep 2026** — no. **Machine = station 1-14; they are one concept**, not two
levels. *[IFL said so — 15 Sep 2026]* Applied in `db/migrations/035_roles_and_answers.sql`
and in Setup, where the machine and station rows were merged into one table
(`web/src/screens/setup/MachinesBlock.tsx`).

**5. Does every sack record tell us which machine produced/packed that sack?**
No. The sack table has no machine or station column of any kind, in either the July or the
September data. This is why per-machine sack *stock* cannot be built from what IFL supplied —
and it is why IFL's own 15 Sep answer to Q28 reframed the requirement. *[We measured it]*

### B. Cone Weight

**6. Which system/database contains the cone weight data?**
`DATA_TP1U2`, table `pack1_TP1U2`. *[We measured it]*

**7. Are ALL cone weights saved, or only rejected/selected cones?**
All of them — 142,510 cones over the 19-day July sample (re-counted 23 Sep 2026 against the
attached copy, excluding two clock-fault rows). Rejects are logged additionally, in separate
tables. *[We measured it]*

**8. What is the normal target cone weight?**
There is no single "normal" weight — it is set per product in PDAS. Re-read 23 Sep 2026 from
`PDAS_TP1U2_SEP07.dbo.Materials`: all six currently active products are set at **1,960 g**;
one retired product sits at 1,950 g. *[We measured it]*

**9. Is the allowed weight range different for different products?**
Yes — ±30 g, ±40 g and ±50 g all appear across products in the real data (re-read 23 Sep
2026; all six active products are ±50 g, the retired ones ±30/±40). *[We measured it]*

**10. Who decides the allowed + and − weight limits?**
**RESOLVED 15 Sep 2026** — there is no fixed limit and no single authority named: **the
limits are to be changeable in the software's own admin settings**, so SMS must own an
editable, versioned limit history rather than only mirroring PDAS.
*[IFL said so — 15 Sep 2026]* Built: `POST /api/products/limits/local` (rank 2 = engineer,
`api/src/routes/cone.ts:70`) appends a version to `sms.product_limit_version` and never
touches PDAS. **See open question N-1 below** — this answer tells us who may change limits
from now on, but not what was in force *before* SMS started recording them.

**11. When a cone is rejected, does the database tell us why?**
Yes, in the sense that separate tables exist for quality-inspection rejects and weight
rejects, each carrying an inspection-result code. *[We measured it]*

**12. What does every reject code mean?**
**RESOLVED 15 Sep 2026** — **there is no predefined list.** The meanings are to be set in the
software's own settings (Setup › Reject codes), by IFL. *[IFL said so — 15 Sep 2026]*
Built: `web/src/screens/setup/RejectCodesBlock.tsx`, `PUT /api/reject-codes/:id`.
**Consequence worth stating plainly: several project documents still list "reject-code
meanings" as blocked on IFL. They are not blocked — they are an IFL data-entry task in the
delivered software.** What remains is that nobody has entered them yet, so today's labels are
honestly blank.

### C. Product Information

**13. What information identifies a product?**
Blend, count and tube type together key a product record, each with its own reference table
in PDAS. A lot number exists at pallet level, but nothing links it to an individual product
record. *[We measured it]*

**14. When production changes from Product A to Product B, how is it recorded today?**
Through IFL's own vendor software: the old product is deactivated and a brand-new product
record is created — there is no "edit". Confirmed by reading the vendor's procedures
directly. *[We measured it]* **One correction to the previous version of this file:** it also
claimed IFL's own engineer "hit exactly this limitation four times in six minutes on 18
August 2026". That corroboration is **unverified** — the 15 Sep audit (finding H6) checked
the ten SSMS screenshots it rests on and found no error of any kind in them; every call shown
returns `@error`/`@errorMsg` = `NULL`/`NULL`. Do not repeat the 18 August story to IFL.

**15. Does the existing system automatically know which product is running?**
Since IFL's August 2026 database rebuild, yes — every cone, sack and reject row carries its
own `MaterialId`. IFL confirmed on 11 Sep 2026 that this identifier is reliable. Before the
rebuild, no such link existed. *[IFL said so, for reliability; We measured it, for mechanism]*

**16. Should the engineer select the current product from our software?**
Built that way — the Current Product selector is the fallback for rows with no `MaterialId`.
*[Our design]*

**17. Should old cones keep the old product and new cones the new one?**
Built that way — every reading is judged against the product and limits in force at that
reading's own timestamp, never today's. *[Our design]*

**18. Should our software be allowed to add/change/retire products in PDAS?**
Wanted, yes — IFL's own engineers make exactly these changes by hand today (11 Sep 2026).
**Granted in writing (WhatsApp, Hassan sb) 19 Sep 2026, owner's statement; formal
confirmation requested; plant switch-on gated on our own local end-to-end proof passing.**
See open question O-1 below for the full history.

**19. If SMS may write to PDAS, who is authorised to make those changes?**
**RESOLVED 15 Sep 2026** — **the process engineer on the floor.** *[IFL said so — 15 Sep
2026]* Applied as a single `engineer` role at rank 2 (verified 23 Sep 2026 against
`sms.role`: 1 viewer · 2 engineer · 3 manager · 4 admin). Note this answers *who*, not
*whether* — see O-1.

### D. Sack Data

**20. Which database contains the sack information?** `DATA_TP1U2`, table `sack1_TP1U2`.
*[We measured it]*

**21. What is saved for every sack?** Sack number, weight, a pass/fail flag and a timestamp.
That is the complete set. *[We measured it]*

**22. Does each sack have a unique number/ID?** There is an internal row id that is reliably
unique; the sack-number field itself periodically resets. *[We measured it]*

**23. Does each sack have weight / date-time / product / machine / lot / pallet?**
Weight yes. Date/time yes (see Q25). Product yes, since September. Machine no. Lot or pallet
no. *[We measured it]*

**24. Is sack weight gross, net, or something else?**
**RESOLVED 15 Sep 2026** — **the total (gross) weight of the sack.** *[IFL said so — 15 Sep
2026]* Applied the same day: `sms.weight_rule` row 9, `basis = 'gross'`, reason "IFL answer
Q24, 15 Sep 2026" (read back 23 Sep 2026). **But see open question N-5: that one column
governs cone weights too, and IFL was only asked about sacks.**

**25. What does the sack timestamp mean?** The time the row was inserted, not when weighing
started or finished — determined from the plant's own triggers. IFL has never confirmed this
in words. *[We measured it]*

**26. Can we know which cone(s) went into each sack?** No. No key links a cone to a sack.
Measured: 0-250 cones between consecutive sacks, nowhere near the ~25 arithmetic suggests.
*[We measured it]*

**27. If not, is it enough to show sack information separately?** Built that way, with the
approximation printed in the same sentence, never as a packing list. *[Our design]*

### E. Sack Stock

**28. What exactly do you mean by "sack stock for each machine"?**
**RESOLVED 15 Sep 2026, and it changed the module.** It means **sack production per machine
by shift and by day, with all relevant information** — a production report, not a
receipts-and-issues ledger. *[IFL said so — 15 Sep 2026]* This is the answer behind the
tenth report type, *Product by machine and shift* (verified 23 Sep 2026:
`api/src/services/reports/common.ts` `REPORT_TYPES` has ten entries, `machine-product`
registered last). **The honest residue:** sacks still carry no machine column, so sack
production *per machine* is still not computable from IFL's data — per shift, per day and
per product is.

**29. Who will enter sack receipt/issue information?**
**SUPERSEDED 15 Sep 2026** by Q28's answer — "receipts and issues" was our reading of the
requirement, not IFL's. The append-only ledger (migration 033) stays built but is now the
optional second block on the Sacks screen. Re-ask only if IFL says they do want a manual
ledger after seeing the production report.

### F. Reports

**33. What reports do you want every day?** and **34. What every shift?**
**RESOLVED 15 Sep 2026** — **every report, daily and per shift.** *[IFL said so — 15 Sep
2026]* Ten report types exist, each with a daily and a shift basis.

**35. What should management see on the main dashboard?**
**RESOLVED 15 Sep 2026** — **live data + today + the shift + machine problems.**
*[IFL said so — 15 Sep 2026]*

**36. Do you want reports in Excel/PDF?**
**RESOLVED 15 Sep 2026** — **both, and they must be beautiful, with graphics.**
*[IFL said so — 15 Sep 2026]* Built since: `api/src/services/reports/xlsx.ts` (with real
chart, drawing and data-bar parts since commit `f61eb35`) and
`api/src/services/reports/pdf.ts` (server-rendered PDF, commit `47ac224`). **Whether the
output is "beautiful" enough is a judgement only IFL can make by looking at it — see open
question A-2.**

**37. Should the system automatically email reports?**
**RESOLVED 15 Sep 2026** — **no.** *[IFL said so — 15 Sep 2026]* Nothing in the app sends
mail, which is now correct rather than merely unbuilt.

### G. Users

**38. Who will use the software?** The GM, managers, and process/quality engineers — one
technical group. *[IFL said so, 2 Sep 2026]*

**39. What should each person be allowed to do?** Every signed-in account sees everything;
only writes are gated by rank. *[IFL said so, 2 Sep 2026, for the shape]* The specifics were
answered on 15 Sep — see Q40/41/43.

**40. Who may change product limits?** · **41. Who may change products?** · **43. Who may
make sack-stock adjustments?**
**ALL THREE RESOLVED 15 Sep 2026 — the process engineer on the floor**, one role for all
three. *[IFL said so — 15 Sep 2026]* Applied as rank 2 `engineer` (verified in `sms.role`,
23 Sep 2026).

**42. Who may see reports?** Everyone signed in. *[IFL said so, 2 Sep 2026]*

### H. Live Data / Speed

**44. How quickly should new production data appear?**
**RESOLVED 15 Sep 2026** — **as soon as possible.** *[IFL said so — 15 Sep 2026]* The app
polls every 10 s.

**45. Is a delay acceptable if the source database itself delays?**
**RESOLVED 15 Sep 2026** — accepted; the ~18-minute acquisition lag is IFL's own and is
stated on screen rather than hidden. *[IFL said so — 15 Sep 2026]*

### I. AI / Calibration

**46. What does "AI should recommend calibration" mean?** · **47. Recommendation only or
automatic adjustment?** · **48. If automatic, who approves?**
**ALL THREE RESOLVED 15 Sep 2026 — recommendation only, no automatic machine adjustment.**
Hassan's words as relayed: *"study the data and tell us."* *[IFL said so — 15 Sep 2026]*
The deliverable is the statistical advisory plus the days-to-action-limit projection.
**One thing was explicitly left unagreed and must not be glossed:** whether that satisfies
the RFQ's "AI" line is still to be agreed with IFL — **never call it AI until it is.**

**49. Do you have records of when a machine was calibrated?** · **50. Records of the weight
before and after?**
No such records exist anywhere in IFL's systems — determined by absence, never confirmed in
words. The software built its own ledger from scratch. *[We measured it, by absence]*
A one-line confirmation from IFL is still worth having, because "none exist" and "none were
sent" are different facts.

### J. Historical Data

**56. Can you provide the 10 July – 5 August 2026 data?**
The gap is real and was **re-measured on 23 September 2026** against both attached copies
rather than taken from any document: `DATA_TP1U2.pack1_TP1U2` ends **2026-07-10 11:23:10**;
`DATA_TP1U2_SEP07.pack1_TP1U2` holds exactly **two** rows before 5 Aug (one dated 1970-01-01
and one 2026-07-12 — clock artefacts, not production) and then runs 5 Aug → 2026-09-07
12:00:28. So the missing window is genuine and about 26 days wide.
**Status: still not answered, because it has still never been formally asked.** Re-checked
23 Sep 2026 — no record of a sent request exists anywhere in the repository. *[Owner, via
the project record]* **This is item 1 on the consolidated list.**

### K. Database / PLC

**60. Can IFL provide the PDAS database details/stored procedures?**
Already held in full from the sample: 18 tables, 13 procedures, 3 views, 14 triggers, every
procedure's code read. What is missing is the same access against the *live* system.
*[We measured it, against the sample]*

**63. What communication protocol do the PLCs use?** · **64. Direct PLC connection, or is
reading the databases enough?**
**Q63 RESOLVED 15 Sep 2026 — no PLC communication and no automation at all**; Q64 was already
answered on 23 Jul 2026 (their Q22: PLC integration out of scope) and was reaffirmed. Reading
the databases is what IFL wants. *[IFL said so — 15 Sep 2026, consistent with their earlier Q22
answer]* Phase 2B is closed, not deferred. Q63 is therefore moot, not open.

**58/59. Read-only access to the Cone / Sack databases.** *(partial)* These are one database,
`DATA_TP1U2`. A sample copy has been used with full read access. The **live** read-only login
is still missing. *[We measured it against a sample; the live grant is open]*

**61/62. What PLC is used for cones / for sack packing?** *(moot)* Both go through the same
acquisition layer; IFL's own PLC registry lists two connections with known addresses. The
hardware *model* was never established — and since Q63/64 closed PLC work entirely, it no
longer needs to be. *[We measured it — network identity only]*

### L. Hardware

**65. Does IFL already have a server/industrial PC?** · **66. Where should the software be
installed?** · **70. Should IFL provide a PC, or should it be quoted?**
**RESOLVED 15 Sep 2026 — the owner supplies a PC with the software already installed.**
*[IFL said so — 15 Sep 2026]* This closes the procurement question. It does **not** close
where that PC physically sits or what it can reach — see Q67, Q68, Q69 below, which the
answer did not touch and which now matter more, not less.

---

## Part 2 — Still genuinely open

Ordered within each section by how much it blocks. The consolidated, plain-language version
of this list — the one to actually send — is **[`IFL-OPEN-QUESTIONS.md`](IFL-OPEN-QUESTIONS.md)**.

### From the original 70

| # | Question | Status |
|---|---|---|
| **56** | The 10 Jul – 5 Aug 2026 data | **Never formally asked.** Highest priority. |
| **51/52/53/54/57** | How much history can be provided (6 months, 12 months, everything) | Owner was pursuing six months as of 15 Sep; **no commitment from IFL exists in any record**. |
| **55** | Does older data exist in backups? | Open. |
| **58/59** | A live read-only login on the plant server | Open; template ready at `db/bootstrap/10_ifl_readonly_login.template.sql`. |
| **60** | The same access against the *live* PDAS, not the sample | Open. |
| **69** | Can the machine that runs SMS actually reach the plant databases? | **Open and now blocking** — the 15 Sep hardware answer (owner supplies the PC) makes this the question that decides whether the delivered PC works at all. |
| **67** | Is there a PC or display near the production floor? | Open. Decides whether Wall mode is worth anything. |
| **68** | Is there a UPS for the server? | Open. |
| **4** | How many sack-packing machines are there? | **Redirected, not answered** — on 15 Sep IFL said to derive it from the data (the `Area` literal suggests one). That is an instruction, not a fact; the number is still unconfirmed. |
| **30** | Where is sack stock tracked today — Excel, ERP, paper? | Open. May be moot after Q28's reframing; ask only if a manual ledger is still wanted. |
| **31/32** | Does each sack type have a code; do machines use different types? | Open. Same caveat as Q30. |
| **29** | Who enters sack receipts/issues | Superseded (see Part 1), re-ask only on demand. |
| **18** | **Written** authority for the nine PDAS write rights | **Contradictory — see O-1.** |
| **49/50** | Calibration history records | Answered by absence; one-line confirmation still wanted. |

### From the 22-question questionnaire (`QUESTIONS.md` numbering — do not confuse with the above)

| # | Question | Status |
|---|---|---|
| **Q5** | **Cone** weight — gross or net; does 1,960 g include the tube? | **Open, and now urgent** — see N-5. |
| **Q7** | Should the plant's own (wrong) Shift column be corrected or reproduced? | Open. The mode is stored in `sms.shift_rule` and changes nothing until answered (`words.ts` `rules.modeNote`). |

### New, raised by the build since 15 September 2026

These are not in the 70-question pack. Each was verified before being written here; the
verification is named.

**N-1 — What weight limits were in force before 11 September 2026?**
Every row of `sms.product_limit_version` is a bootstrap written by migration 027, all 14
stamped `2026-09-11 10:03:15.957` with the reason *"Bootstrapped from the sms.product mirror
at migration 027; true start unknown."* (counted and read back 23 Sep 2026). SMS therefore
holds **no record of what any product's limits were before that instant**, which is why every
report covering August correctly refuses to state a target rather than back-dating today's.
Only IFL can supply the real history. Blocks: truthful targets on every August report.

**N-2 — `201-IHO-SD` or `201-IH0-SD`?**
`PDAS_TP1U2_SEP07.dbo.Materials` holds four products in this family (read 23 Sep 2026):
MaterialIds 11, 12, 13 spelled `201-IH0-SD` with a **zero**, and MaterialId 15 spelled
`201-IHO-SD` with the **letter O**. All four are inactive and none appears on any reading in
the September sample, so nothing is currently mis-attributed — but they sit adjacent in the
catalogue and are indistinguishable at a glance. Almost certainly a typing slip; only IFL can
confirm and correct it in their own master.

**N-3 — Six products share the display name `205-IL0-SD`.**
MaterialIds 20, 21, 1021, 1022, 1023 and 1024 all carry `MaterialDesc1 = '205-IL0-SD'` and
are distinguished only by colour, yarn count and tube — and two of them (1021 and 1023) share
the colour `ORANGE` as well, differing only by count and tube. **These six are not an edge
case: they are every product that ran in the September sample** (52,887 + 49,050 + 21,149 +
6,262 + 2,107 + 1,095 cones — all of production). SMS disambiguates them on screen
(`distinctProductLabels()`, commit `a0c87ba`), but the underlying name is IFL's. Is one name
for six products intended, or should the name itself carry the distinction?

**N-4 — Will IFL approve the KPI definitions?**
`KPI-DEFINITIONS.md` has 32 rows and **every one says "IFL approval: awaiting"**. The
15 Sep answers settled *which* reports and *what format*; they did not settle what any
number on them means. Blocks: signing off the reporting phase.

**N-5 — Cone weight basis, and the placeholders now in force.**
IFL's 15 Sep answer to Q24 was about **sacks** ("the total weight of the sack"). It was
applied to `sms.weight_rule`, which has **one `basis` column for the whole line** — so cone
weights are now computed on the `gross` basis too, on the strength of an answer about sacks
(read back 23 Sep 2026: row 9, basis `gross`, reason "IFL answer Q24, 15 Sep 2026"). The two
conversion constants in the same row, `cone_tube_weight_g = 70.00` and `sack_tare_kg = 0.500`,
are **developer placeholders that IFL has never seen**. Ask: does the 1,960 g cone setpoint
include the tube, and what are the real tube and tare weights?

*No number is currently wrong because of this, and that should be said plainly:* at the
`gross` basis the conversion is the identity — the tube weight is subtracted only under `net`
(`api/src/services/weights.ts:239`), and the screen still prints "Weight basis is unconfirmed"
with the exact consequence spelled out (`weights.ts:370-375,417`). The defect is that one
setting answers two questions and IFL was asked only one of them.

**N-6 — Does the PLC take the running product from PDAS's active flag, or from the machine
HMI?** Raised at the 15 Sep meeting itself and left open there. It decides whether a product
change made through SMS actually reaches the machine or only the records.

**N-7 — Two developer-proposed rules awaiting a yes/no.**
(a) The 24-case cone-classification fixture (`sms/test/fixtures/cone-classification.json`);
(b) what to do when the scale's own pass/fail flag disagrees with the product tolerance
(today: state both facts separately, never one merged verdict).

**O-1 — The PDAS write authority is recorded two ways and they contradict each other.
RESOLVED 24 Sep 2026 (owner's statement).**

History, kept for the record:
- `handover/IFL-ANSWERS-2026-09-15.md:7` records that on 15 Sep the authority was **still
  verbal**, and says to keep `PDAS_WRITE_ENABLED=false`.
- Commit **`af420a4`** (22 Sep 2026) states in its message: *"IFL granted permission for SMS
  to write product data to PDAS. The owner instructed that the path be enabled."*
- **No document anywhere in the repository records that grant** — not its date, not who gave
  it, not which of the nine rights it covers (checked 23 Sep 2026).
- `sms/.env` today reads `PDAS_WRITE_ENABLED=false` (read 23 Sep 2026), i.e. the flag the
  commit says was turned on is off again.
- Also still true, and stated in that same commit: **no PDAS procedure has ever been executed
  against any database, local or plant.**

**Resolution (24 Sep 2026, owner's statement):** the owner states that Hassan sb, IFL, gave a
written WhatsApp permission on 19 September 2026, covering both the local test copy and the
plant, and reading as "complete autonomy and permission to enable and work on the PDAS
changing the DB." The owner's reading is that this covers all nine of the rights listed in
`IFL-OPEN-QUESTIONS.md` item 3. Process engineers will be the users of the resulting
workflow. The code path has not yet been run end to end, and the plant will not be switched
on until the local end-to-end test passes. See `DEFECTS.md` D-12 and
`handover/PDAS-WRITE-GRANT-2026-09-19.md` for the full record.

---

## Tally, 23 September 2026

| | Count |
|---|---|
| Answered by IFL in words — 15 Sep 2026 | 24 |
| Answered by IFL in words — earlier (2 Sep, 11 Sep) | 6 |
| Answered by measuring IFL's own data or documents | 21 |
| Our own design choice, awaiting a blessing rather than an answer | 3 |
| Closed as moot by the no-PLC answer (61, 62, 63) | 3 |
| **Genuinely open, from the original 70** | **18 numbers** |
| Answered but worth a one-line confirmation (29, 49, 50) | 3 |
| **Open, from the 22-question questionnaire** | **2** (its Q5, its Q7) |
| **New, raised by the build** | **8** (N-1 … N-7, O-1) |

**Counting rule, so the number can be checked.** The 18 open numbers from the 70-question
pack are: **4, 18, 30, 31, 32, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 67, 68, 69.**
Several of those are one conversation rather than one question each (51/52/53/54/57 are all
"how much history"; 58/59/60 are all "a live read-only login"), so expressed as things to
*ask* rather than numbers to *quote*, the whole open set collapses to the **15 numbered asks**
in [`IFL-OPEN-QUESTIONS.md`](IFL-OPEN-QUESTIONS.md). That is the document to send; this one is
the audit trail behind it.

The sections with the least coverage are no longer reports and sack stock — the 15 Sep
answers closed both. They are now **history** (J), **hardware reachability** (L: 67/68/69)
and **the pre-September limit history** (N-1).
