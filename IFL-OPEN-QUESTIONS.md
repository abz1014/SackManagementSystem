# What we still need from IFL

**Prepared 23 September 2026. Fifteen asks, in the order of what they unblock.**

This is the single list. It replaces hunting through `IFL-QUESTIONS-STATUS.md`,
`PROJECT_STATUS.md` §5, `ROADMAP-GAP-ANALYSIS.md` §18 and `DECISIONS-PENDING.md` for the same
information in four shapes. Everything IFL has already answered has been taken out — in
particular the twenty-four questions Hassan sb answered on **15 September 2026**, which are
recorded with their answers in `IFL-QUESTIONS-STATUS.md` Part 1, summarised in the table at
the end of this document, and are **not** to be asked again.

Each item says three things: what we need, **what is blocked without it**, and **what it
costs to stay blocked**. The cost line is the honest one — several of these are survivable,
and saying so is what makes the two that are not stand out.

**Two facts that belong at the top of any covering note, because they qualify everything
below.** Nothing in this software has ever run against IFL's live plant systems; every
measurement quoted here comes from the two database copies IFL sent (June–July and
August–September 2026) attached to a development machine. And no PDAS stored procedure has
ever been executed against any database, live or local.

---

## Tier 1 — Blocks go-live. Nothing else in this list matters as much.

### 1. A read-only database login on the live plant server, and the host it runs against
*(70-pack Q58, Q59, Q60)*

A dedicated read-only SQL login (`db_datareader` on `DATA_TP1U2` and `PDAS_TP1U2`) on the
plant's own server, not `sa` and not the vendor application's account, plus the server name
and instance. A script IFL's DBA can run unchanged is ready at
`sms/db/bootstrap/10_ifl_readonly_login.template.sql`.

**Blocked without it:** everything that makes this a live system rather than a demo. The
cutover rehearsal, reconciliation against IFL's own data, the scheduled backup, and the
Windows service install all wait on this.

**Cost of staying blocked:** total. The product cannot be installed. Every number anyone has
ever seen from it describes a copy of IFL's data that stops on 7 September 2026.

### 2. Can the PC we supply actually reach those databases?
*(70-pack Q69 — the one the 15 September hardware answer did not touch)*

On 15 September IFL confirmed the owner supplies the PC with the software installed, which
settled the procurement question. It did not settle the network one. We need to know that the
machine, wherever it is placed, can open a connection to the plant's SQL Server — and if the
PLC and server address ranges are genuinely segregated, which side the PC will sit on.

**Blocked without it:** installation day.

**Cost of staying blocked:** a PC is delivered, powered on, and discovers it cannot see the
data. This is a cheap question now and an expensive one on site.

### 3. Written authority for SMS to write product data to PDAS — or written confirmation that it has already been given
*(70-pack Q18. **Owner action first — see the note.**)*

The nine rights the write path uses, and no others, across `dbo.Materials`, `dbo.Blends`,
`dbo.Counts`, `dbo.TubeTypes`, `dbo.Pallets` and `dbo.nhs_events`: EXECUTE on
`CreateMaterial`, `SetMaterialStatusActive`, `AddBlend`, `AddCount`, `AddTubeType`,
`CreatePallet` and `SetPalletStatusActive`; UPDATE on `dbo.Materials` alone (the vendor ships
no UPDATE procedure, so a setpoint change is one guarded single-row update); INSERT on
`dbo.nhs_events`, the vendor's own event-log row written alongside it. **No new objects, no
DELETE, no other table, ever.**

**⚠️ Do not send this ask until the owner resolves a contradiction in our own records.**
`handover/IFL-ANSWERS-2026-09-15.md` says the authority was still verbal on 15 September and
that the write flag should stay off. Commit `af420a4` (22 September) says in its message that
*"IFL granted permission for SMS to write product data to PDAS"* and that the owner instructed
the path be enabled. No document records that grant — no date, no author, no scope — and the
flag is off again today. Asking a client to re-give permission they already gave reads as
badly as switching on a write path against a permission nobody can produce.

**Blocked without it:** the product changeover workflow, which Hassan sb himself named as the
key requirement on 15 September. The whole flow is built and reachable; the final step
returns "disabled" by design.

**Cost of staying blocked:** the headline feature of the last two months plans a change and
then cannot make it. An engineer still has to go to SSMS and type the procedure call by hand,
which is exactly what this was meant to replace.

---

## Tier 2 — Blocks numbers being true, not features existing.

### 4. What weight limits were in force before September 2026?
*(New — raised by the build)*

For each product, the setpoint and the ± tolerance, with the dates they applied from. Even
approximate dates are worth having.

**Why we are asking:** SMS's limit history contains fourteen rows, all written at one instant
on 11 September 2026 when the software first mirrored PDAS, each carrying the reason *"true
start unknown."* We hold no record of what any limit was before that moment.

**Blocked without it:** any report covering August or earlier can state what was weighed but
must refuse to state whether it met target. It refuses rather than guessing, which is correct
and looks like a gap.

**Cost of staying blocked:** every historical weight report is permanently half-blind. If
IFL can supply the history, those reports become answerable retrospectively; if not, they
never will be.

### 5. Do you approve the definitions behind the numbers on the reports?
*(New — `KPI-DEFINITIONS.md`, 32 rows)*

One sheet, 32 rows, each naming a number the reports print, what it is divided by, which
clock it uses and what it excludes. Every row currently reads "IFL approval: awaiting".

**Blocked without it:** formal sign-off of the reporting phase.

**Cost of staying blocked:** low day to day — the reports work and every number is traceable
to the rows it came from. But an unapproved definition is a disagreement waiting for the
first month-end where a figure does not match IFL's own expectation.

### 6. Cone weight: does the 1,960 g target include the tube? And what are the real tube and tare weights?
*(22-question pack Q5; the sack half, its Q4, was answered on 15 September)*

**Why we are asking:** IFL's 15 September answer — "sack weight is the total weight of the
sack" — was applied to a setting that governs the whole line, so cone weights are now
computed on a gross basis too, on the strength of an answer that was about sacks. The two
conversion constants sitting beside it, a 70 g cone tube and a 0.5 kg sack tare, are
developer placeholders IFL has never seen.

**Blocked without it:** the Weight screen states the average and the target as two separate
facts rather than as one difference, deliberately, because a difference computed on the wrong
basis would be a wrong number presented as a fact.

**Cost of staying blocked:** the single most-read number in the application stays a sentence
instead of a figure.

### 7. Should the plant's own Shift column be corrected, or reproduced as-is?
*(22-question pack Q7)*

The plant derives each row's shift from the time the record was inserted, not the time the
cone was weighed, so some rows carry a shift SMS would compute differently. SMS can either
correct it or reproduce IFL's own answer exactly — but it must do one, consistently.

**Blocked without it:** nothing, today. The choice is stored and applied to nothing.

**Cost of staying blocked:** low until the first time IFL compares a shift total from SMS
against a shift total from their own system and the two differ. Then it is the first thing
anyone asks about.

### 8. Three things we decided for you, and would like blessed or overruled
*(New; (c) is `REDESIGN.md` §11 item 3, drafted 3 Sep 2026 and never sent)*

(a) A 24-case worked example of how a cone weight becomes "within limits", "low", "high",
"rejected" or "unknown" — a page to read and initial.
(b) What should happen when the scale's own pass/fail flag disagrees with the product's
tolerance. Today SMS states both facts separately and never merges them into one verdict.
(c) **Is the word "AI" contractual?** The quotation names AI-based analytics. What is built
is statistics — control rules, station drift, and a projection of how many days until a
station reaches its action limit. Hassan's own answer on 15 September was *"study the data and
tell us,"* recommendation only, which is exactly that; but he left open whether it satisfies
the quotation's AI line. We would rather agree the word now than at acceptance.

**Blocked without it:** nothing is stopped; these are decisions already taken by us that IFL
has the right to overrule. (c) is different in kind — it is a contractual wording question,
not a technical one, and it should be settled before acceptance rather than during it.

**Cost of staying blocked:** low, but they are cheap to settle in a meeting and expensive to
re-litigate after a disputed reading.

---

## Tier 3 — History. Cheap to ask, slow to arrive, and the clock is running.

### 9. The 10 July – 5 August 2026 data
*(70-pack Q56 — **this has never actually been asked**)*

Twenty-six days that exist at IFL and in no copy we hold. Re-measured on 23 September 2026
against both attached copies rather than taken from any document: the first sample's last
cone is **10 July 2026, 11:23**; the second sample's first real production row is **5 August
2026** (the only two rows dated earlier are clock artefacts — one stamped 1970 and one 12
July).

**Blocked without it:** a continuous production history. There is also a second, separate
problem: even when the data arrives, the software cannot currently load it, because the
archive-ingest path was never finished (tracked as R-17 in `DEFECTS.md`). That is our work,
not IFL's, and it should be done before the data lands rather than after.

**Cost of staying blocked:** every month that passes makes it likelier IFL's own retention
window has discarded it. They keep roughly a month. **This one gets worse with time; most of
this list does not.**

### 10. How much history can you give us in total — six months, twelve, everything?
*(70-pack Q51, Q52, Q53, Q54, Q57; and Q55, whether older data survives in backups)*

Cone and sack readings, rejects with their codes, product and machine identifiers, and any
calibration records.

**Blocked without it:** any predictive or trend work that deserves the name. Six months is
the minimum before a calibration model is honest; we hold 53 production days.

**Cost of staying blocked:** the "AI" line in the original quotation stays a statistical
advisory over eight weeks of data. That advisory is defensible and real — but it is not what
twelve months would allow, and the difference should be IFL's choice, not a silent one.

---

## Tier 4 — Worth one line each. Not worth a meeting.

### 11. Is there a PC or display near the production floor — and do you want the screens in Urdu?
*(70-pack Q67; the Urdu half is `REDESIGN.md` §11 item 4, drafted 3 Sep 2026 and never sent)*
A full-screen board readable across a room is built and works. Without a screen it is dead
code. Separately: every word on every screen lives in one file, so a second language is a
translation job rather than a rebuild — but only if we know it is wanted before the interface
is signed off. **Cost of staying blocked:** one built feature nobody sees, and a translation
that gets more expensive the later it is asked for.

### 12. Is there a UPS for the machine that will run this?
*(70-pack Q68)* **Cost of staying blocked:** an unclean shutdown is recoverable — the sync
worker reconciles an interrupted pass on restart — but it is the kind of thing that is cheap
to know before rather than after.

### 13. How many sack-packing machines are there?
*(70-pack Q4)* On 15 September IFL said to derive this from the data, which suggests one. We
would rather have the number than the inference.

### 14. Sack types — is there a code per type, and do different machines use different types?
*(70-pack Q30, Q31, Q32)* **Ask these only if IFL still wants a manual sack ledger.** Their
15 September answer redefined "sack stock per machine" as production per machine by shift and
day — a report, not a stores ledger — which may make all three moot. Worth one sentence to
confirm they are moot rather than assuming it.

### 15. Three things we concluded from your data rather than from you — please correct us if we are wrong
*(70-pack Q29, Q49, Q50, plus two catalogue observations)*

- You hold **no records of past machine calibrations**, and none of weights before and after
  one. We built our own log from scratch on that assumption.
- The sack timestamp is the moment the record was **saved**, not when weighing began or ended.
- In your product master, `201-IHO-SD` (MaterialId 15) is spelled with the letter **O** while
  `201-IH0-SD` (MaterialIds 11, 12, 13) is spelled with a **zero**. They sit next to each
  other in the catalogue. All four are inactive and none appears on any reading we hold, so
  nothing is currently mis-recorded — we think it is a typing slip and only you can correct
  it.
- **Six different products all share the display name `205-IL0-SD`** (MaterialIds 20, 21,
  1021, 1022, 1023, 1024), told apart only by colour, yarn count and tube — and two of them
  share the colour as well. These six are not obscure: they are every product that ran in the
  August–September data you sent. Our screens add the distinguishing detail so an operator is
  never shown six identical names, but the names themselves are yours. Is one name for six
  products intended?
- And one open design point from the 15 September meeting itself: **does the machine take the
  running product from PDAS's active flag, or from the operator's HMI?** It decides whether a
  product change made in software reaches the machine or only the records.

---

## What IFL has already answered — do not ask these again

Recorded 15 September 2026, from Hassan sb via the project owner. The full text and what each
one changed in the software is in `IFL-QUESTIONS-STATUS.md` Part 1.

| Question | The answer |
|---|---|
| 14 Rieter winders? | Yes |
| Separate stations or spindles? | No — machine and station are one thing, 1–14 |
| Who sets the weight limits? | No fixed limit — editable in the software's settings |
| What do the reject codes mean? | No predefined list — named in the software's settings |
| Is sack weight gross or net? | Gross — the total weight of the sack |
| "Sack stock per machine"? | Sack production per machine, by shift and by day |
| Which reports, how often? | Every report, daily and per shift |
| Excel or PDF? | Both, with graphics, and they must look good |
| Email reports automatically? | No |
| What goes on the management dashboard? | Live data, today, the shift, and machine problems |
| Who changes products, limits, sack figures? | The process engineer on the floor |
| How fresh must the data be? | As soon as possible; the source's own delay is accepted |
| What does "AI recommends calibration" mean? | Study the data and tell us — recommendation only, never automatic |
| Direct PLC connection? | No PLC communication or automation at all |
| Who supplies the PC? | The owner, with the software already installed |

**And the requirement Hassan named as the most important:** machine 1 runs product A on the
morning shift; the engineer changes the product through the software so the evening shift
runs product B; the reports must show, per machine, which product ran in which shift — with a
separate product-by-machine-by-shift report. That report exists (it is the tenth report type,
added in direct response to this answer). The changeover workflow that would make the change
in PDAS is built and reachable, and is held at its final step by item 3 above.
