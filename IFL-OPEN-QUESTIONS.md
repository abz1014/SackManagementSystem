# What we still need from IFL

**Prepared 23 September 2026, re-verified the same day against the running databases
(sidecar and both attached IFL copies, read-only) rather than re-quoted from earlier
drafts. Fifteen asks, in the order of what they unblock.**

## Covering note

*Pasteable, to send as-is or edit before sending.*

> Hi Hassan,
>
> Thank you again for the 15 September session — we've worked through all twenty-four
> answers and updated the software accordingly (the process-engineer role, gross sack
> weight, the reject-code settings screen, the tenth report, and the rest).
>
> A shorter list remains open on our side, grouped by how much it blocks. **Two items
> matter far more than the rest, and everything else can wait for your convenience:**
>
> 1. A read-only database login on the live plant server (not `sa`, not the vendor
>    application's own account), and the server/instance name it runs against.
> 2. Confirmation that the PC we install this on can actually reach those databases —
>    and, if the PLC and server networks are kept separate, which side it should sit on.
>
> The rest of the list covers historical data, a few numbers we'd like you to bless or
> correct, and some one-line confirmations of things we inferred from the data you already
> sent. None of it blocks installation the way the two above do.
>
> Full list attached (`IFL-OPEN-QUESTIONS.md`). Happy to walk through it on a call if
> that's faster than reading it cold.
>
> Regards,
> [owner]

## If you answer only three things

Tier 1 below has three items, in short — **but only two of them are in the covering note
above.**

1. **A read-only login on the live plant server, and the host it runs against.**
   Without this the product cannot be installed — everything else is secondary to it.
2. **Can the PC we supply actually reach those databases**, and if the PLC and server
   networks are genuinely segregated, which side does it sit on.
3. **Formal confirmation of the 19 September PDAS write permission, and the login for your
   DBA (`sms_pdas_writer`).** Lower priority than the two above: the 19 September WhatsApp
   go-ahead already lets us finish building and testing locally. We are simply asking for it
   in writing, and for the DBA login, ahead of switching it on at the plant. See item 3
   below.

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
`sms/db/bootstrap/10_ifl_readonly_login.template.sql` (re-verified 23 Sep 2026: the file
exists at that path, alongside two related bootstrap templates for PDAS procedure metadata
and the PDAS writer login).

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

### 3. Formal confirmation of the 19 September PDAS write permission, and the login for your DBA
*(70-pack Q18)*

Thank you again for the go-ahead Hassan sb gave over WhatsApp on 19 September, allowing SMS
to enable and work on the PDAS product database. We would like to ask you to confirm this
formally, by email or a signed note, so the record does not rest on a single chat message.
Please could the confirmation name the nine specific rights it covers, across
`dbo.Materials`, `dbo.Blends`, `dbo.Counts`, `dbo.TubeTypes`, `dbo.Pallets` and
`dbo.nhs_events`: EXECUTE on `CreateMaterial`, `SetMaterialStatusActive`, `AddBlend`,
`AddCount`, `AddTubeType`, `CreatePallet` and `SetPalletStatusActive`; UPDATE on
`dbo.Materials` alone (the vendor ships no UPDATE procedure, so a setpoint change is one
guarded single-row update); and INSERT on `dbo.nhs_events`, the vendor's own event-log row
written alongside it. **No new objects, no DELETE, no other table, ever.**

For your DBA, we would also ask for a dedicated login, `sms_pdas_writer`, scoped to exactly
those nine rights plus read-back SELECT on `dbo.Materials`, `dbo.Blends`, `dbo.Counts`,
`dbo.TubeTypes` and `dbo.Pallets`, and nothing else. The full request letter and the grant
script your DBA can run unchanged are at
`handover/IFL-PDAS-WRITER-LOGIN-REQUEST-2026-09-24.md`.

To be clear about timing: we will not switch this on against your live plant database until
our own local end-to-end test, on the copy you already sent us, has passed. We will let you
know before the very first write reaches the plant.

**Blocked without it:** the product changeover workflow, which Hassan sb himself named as the
key requirement on 15 September. The flow is built and reachable; the final step, writing to
the plant, stays disabled until our own local end-to-end test passes and the
`sms_pdas_writer` login exists on your side. Formal written confirmation is asked for the
record, not as a condition of switching the plant on.

**Cost of staying blocked:** lower than before. The 19 September go-ahead lets us finish
building and testing against the local copy now; the plant switch-on waits on the local
end-to-end proof and the `sms_pdas_writer` login, not on this letter.

---

## Tier 2 — Blocks numbers being true, not features existing.

### 4. Has a product's weight setpoint ever been changed by a direct database edit, outside your normal screens?
*(New — raised by the build; substantially narrower than it was a day ago, see below)*

**This item changed today and is smaller than it was.** Until 23 September 2026 our software
held no record of what any product's limits were before 11 September, when it first mirrored
your product database — every one of the fourteen rows in our limit history was a guess dated
"true start unknown." **That is no longer true.** Re-verified today (`sqlcmd -E`, read-only,
against `PDAS_TP1U2_SEP07.dbo.Materials`): each product record carries its own creation
timestamp, and we confirmed — four independent ways — that this timestamp is never moved once
the record is created, including when a product is retired and reactivated. So we now date
every product's limits from the moment your own system created it, not from when we happened
to notice it. All fourteen products in the current data now carry a real creation date, from
2026-05-06 (the earliest) to 2026-09-03 (the newest) — zero are still "unknown."

**What is genuinely still open, and it is the one thing we cannot determine from your data
alone:** your product database gives us no way to log an *edit* to an existing product's
setpoint, only a create and a retire — so if someone ever typed a direct update straight into
SQL to change a setpoint (rather than retiring the old product and creating a new one), it
would leave no trace we can find: it would not move the creation timestamp and it would not
appear in your own event log. Has this ever been done, to your knowledge? A "no, changes
always go through retire-and-recreate" is exactly as useful an answer as a "yes, here's when."

**Blocked without it:** nothing today — every report we can currently generate over your data
now states a real, dated limit rather than an assumed one. What remains blocked is our
*confidence* that a limit we show for a given date was the only one in force that day, rather
than one changed by an edit we cannot see.

**Cost of staying blocked:** low. This is a corroborating question, not a blocking one — ask
it when convenient rather than urgently.

### 5. Do you approve the definitions behind the numbers on the reports?
*(New — `KPI-DEFINITIONS.md`, 32 rows)*

One sheet, 32 rows, each naming a number the reports print, what it is divided by, which
clock it uses and what it excludes. Every row currently reads "IFL approval: awaiting"
(re-counted 23 Sep 2026 directly against `KPI-DEFINITIONS.md`: exactly 32 numbered rows,
every one still "awaiting" — none has been approved since the sheet was written).

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
developer placeholders IFL has never seen (re-verified today directly against the live
setting: `basis = gross`, `cone_tube_weight_g = 70.00`, `sack_tare_kg = 0.500`, reason on file
"IFL answer Q24, 15 Sep 2026" — unchanged since it was written).

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

Twenty-six days that exist at IFL and in no copy we hold. **Re-measured again today**
(`sqlcmd -E`, read-only, against both attached copies directly rather than taken from any
document or from this file's own earlier draft): `DATA_TP1U2.pack1_TP1U2`'s last row is
**10 July 2026, 11:23:10**; `DATA_TP1U2_SEP07.pack1_TP1U2`'s first real production row is
**5 August 2026, 12:30:44** (the only two rows dated earlier are clock artefacts — one
stamped 1970-01-01 and one 2026-07-12). Both figures reproduced exactly on this pass — no
change from the previous count.

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
the minimum before a calibration model is honest; we hold **53 production days**
(re-counted today directly against both attached copies: 19 distinct production days in the
July sample, 2026-06-22 through 2026-07-10, excluding one clock-fault row dated
2026-06-21; 34 distinct production days in the September sample, 2026-08-05 through
2026-09-07; 19 + 34 = 53).

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
*(70-pack Q29, Q49, Q50, plus three catalogue observations)*

- You hold **no records of past machine calibrations**, and none of weights before and after
  one. We built our own log from scratch on that assumption.
- The sack timestamp is the moment the record was **saved**, not when weighing began or ended.
- In your product master, `201-IHO-SD` (MaterialId 15) is spelled with the letter **O** while
  `201-IH0-SD` (MaterialIds 11, 12, 13) is spelled with a **zero** (re-verified today directly
  against `PDAS_TP1U2_SEP07.dbo.Materials`). They sit next to each
  other in the catalogue. All four are inactive and none appears on any reading we hold, so
  nothing is currently mis-recorded — we think it is a typing slip and only you can correct
  it.
- **Six different products all share the display name `205-IL0-SD`** (MaterialIds 20, 21,
  1021, 1022, 1023, 1024 — re-verified today directly against the same table), told apart only
  by colour, yarn count and tube — and two of them (1021, 1023) share the colour ORANGE as
  well. These six are not obscure: they are every product that ran in the
  August–September data you sent. Our screens add the distinguishing detail so an operator is
  never shown six identical names, but the names themselves are yours. Is one name for six
  products intended?
- And one open design point from the 15 September meeting itself: **does the machine take the
  running product from PDAS's active flag, or from the operator's HMI?** It decides whether a
  product change made in software reaches the machine or only the records.
- **New, from today's build — the 18 August incident is now explained, not just confirmed, and
  we are telling you something rather than asking why.** An earlier version of our project
  notes said your engineer hit a "duplicate product" refusal four times in six minutes on
  18 August, sourced from ten SSMS screenshots that in fact show no error — so an earlier pass
  of this document marked the story unverified. It no longer is. Your system's own event log
  records it directly (re-verified today, read-only, against `PDAS_TP1U2_SEP07.dbo.nhs_events`):
  four "Material already exist" refusals at **10:35, 10:39, 10:40 and 10:41** on 18 August,
  bracketed by your own software deactivating and then reactivating MaterialId 1022 at 10:39:01
  and 10:43:17 — your engineer retiring the product and immediately trying to recreate it.
  Today, with your permission, we ran that exact sequence against our local copy of your data
  (never the live database) to find out why it fails. **It cannot succeed, for any blend/count/
  tube combination, no matter how it is retried:** the vendor's own "create product" procedure
  checks only whether that blend/count/tube already exists, and that check does not look at
  whether the existing row is active or retired. Retiring first makes no difference. Your
  engineer's 18 August attempt was never going to work — this is not a bug in our software, and
  it is not something a future version of our software can route around, because the refusal
  happens inside the vendor's own procedure before our software is even involved.

  The supported way to change a running product's setpoint is to **edit the existing material
  in place**, which our software already offers as a single guarded update that writes to your
  own event log exactly as your other procedures do — this is the changeover screen Hassan sb
  described as the key requirement on 15 September, and it does not require retiring or
  recreating anything. **The one part only you can answer:** is editing in place acceptable to
  you as the standard way to handle a changed product, or is there a reason you need a brand new
  material id when a product changes — traceability, your own reporting, something in your QCS
  workflow we cannot see from the data alone? If the latter, tell us what depends on a new id
  and we will look for a way to give you one without hitting this refusal.
- **One more thing worth flagging while we're in this area, not a question.** The same
  procedure that refused your engineer also writes its own confirmation log line wrong: when it
  successfully creates a product, the log entry that is meant to record the new product's id
  instead records the blend's id — a copy-paste mistake in the vendor's code, reconfirmed today
  on two separate test rows. It has nothing to do with the 18 August incident and causes no
  wrong data in your tables, but if anyone at IFL ever reads that log column expecting it to
  name the product that was created, it has been quietly wrong since the procedure was written.
  Worth knowing; not something we need an answer to.

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
