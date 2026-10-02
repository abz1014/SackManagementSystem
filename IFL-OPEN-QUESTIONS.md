# What we still need from IFL

**Prepared 23 September 2026, re-verified the same day against the running databases
(sidecar and both attached IFL copies, read-only) rather than re-quoted from earlier
drafts. Extended 29 September 2026 (items 16–21) and 1 October 2026 (items 22–29, the eight
reports). Twenty-nine asks in all — fifteen when first prepared — in the order of what they
unblock.** Items 1–15 keep their 23 September numbers; items 22–29 (Tier 5) are drafted and not
yet sent.

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
ever been executed against any database, live or local. *(Corrected 1 October 2026: that last
sentence is out of date. Authorised passes on 23 September executed the product procedures
against the local copy of PDAS only, and by 28 September all nine write rights had been
exercised through our own code against that copy. None has ever run against IFL's live PDAS.)*

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

**One specific permission inside that same login, added 24 September 2026 and not obvious
from "`db_datareader`" alone: the login must be able to read schema/catalogue metadata, not
just table rows.** Every pass, the sync worker asks the server what shape its own tables are
in — this is how it notices IFL renaming or adding a column, the way `Source` became
`MachineNo` and `MaterialId` was added on 5 August 2026 — by querying four system views:
**`sys.tables`, `sys.columns`, `sys.types`, and `INFORMATION_SCHEMA.COLUMNS`.** Measuring
this (`PERFORMANCE-SOURCE-LOAD-2026-09-24.md`) needed Windows authentication locally, because
this project's own current `IFL_DB_USER` — which holds `db_datareader` on
`PDAS_TP1U2_SEP07` — was not enough for a *different*, narrower catalogue read a 16 September
task needed (`sys.procedures`/`sys.parameters`, to confirm a stored procedure's own
parameters). `db_datareader` ordinarily includes `SELECT` on these four views as part of the
database, so the four above should already be covered by item 1's ask as written — but that
has not been confirmed against IFL's actual grant, because that login does not exist yet. **If
it turns out not to be included, this is the specific, narrower ask: `SELECT` on `sys.tables`,
`sys.columns`, `sys.types` and `INFORMATION_SCHEMA.COLUMNS` on both `DATA_TP1U2` and
`PDAS_TP1U2`, in addition to ordinary table `SELECT`.**

**Blocked without it:** everything that makes this a live system rather than a demo. The
cutover rehearsal, reconciliation against IFL's own data, the scheduled backup, and the
Windows service install all wait on this. Specifically for the catalogue-read permission
above: without it, schema-drift detection and source-generation ("epoch") identification —
the mechanism that caught the 5 August rebuild and stopped the sync worker from silently
reporting "success" while reading nothing — cannot run at all on installation day. This is
not a hypothetical: this project already knows a plant login can be narrower than
`db_datareader` implies (`ibrahim`, seen during the PDAS introspection work, is
EXECUTE-only, with no `db_datareader` and no `VIEW DEFINITION` on any procedure).

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

### 16. What does a sack or reject weight of exactly 0 mean: scale fault, test, or a record to ignore?
*(Added 29 September 2026, from a documentation-sync/verification pass. Numbered 16 rather
than inserted into Tier 2's own run — items 1-15 are cited by number elsewhere in this
repo, e.g. `IFL-OPEN-QUESTIONS.md` item 3 in `handover/PDAS-WRITE-GRANT-2026-09-19.md` and
`IFL-TECHNICAL-ANNEX.md`, so their numbers are not renumbered to make room.)*

Our own DQ check (`nonpositive_weight`, ERROR severity — `weight <= 0`) is firing correctly
on three real rows in your data, re-verified directly against the attached databases:

- `DATA_TP1U2.sack1_TP1U2` id=1209 — `Weight 0`, `inRange 0`, 2026-06-26.
- `DATA_TP1U2_SEP07.sack1_TP1U2` id=3125 — `Weight 0`, `MaterialId 0`, 2026-08-21.
- `DATA_TP1U2.rejectWeight1_TP1U2` id=153 — `Weight 0`, carrying the same 1970-01-01
  clock-fault `ProductionDate` sentinel already flagged elsewhere in this project
  (`DEFECTS.md` D-29).

These are not a bug in our software — we checked the possibility that our own plant
simulator produced them and it did not; they are genuine rows in your own tables. We do not
know what a weight of exactly 0 means on your equipment: a scale fault (nothing on the
platform, or a fault reading), a test/calibration weighing that should never have been
logged as production, or something else entirely.

**Blocked without it:** nothing today — the rows are correctly flagged and excluded from
averages by the app's own plausibility rules either way. This is a request to understand
your data, not a fix waiting on an answer.

**Cost of staying blocked:** low, but if 0 turns out to mean something specific on your
equipment (e.g. "ignore this row, it was a test") we could name it on screen instead of
just flagging it as an error, which would make the finding more useful to whoever reads it.

### 17. When you send the 10 Jul – 5 Aug archive, what format — and can it be a database backup?
*(Added 29 September 2026, from the owner-scope hardening loop.)* We can load this gap once
it arrives (the software side of that is built and tested against a stand-in database, though
not yet rehearsed against a real one — our own work, not something we need from you). Our
strong preference is **a `.bak` file of `DATA_TP1U2` taken before the 5 August rebuild** —
a database backup restores cleanly and completely, where a spreadsheet or CSV export risks
losing precision, column types, or rows silently. If a `.bak` from that exact date no longer
exists, tell us what you do have (a later backup, an export, anything) and we'll work with it.

**Blocked without it:** the 10 Jul – 5 Aug gap in every report and trend stays a gap.

**Cost of staying blocked:** the longer this waits, the likelier it is that even a later
backup no longer reaches back before 5 August, given your own retention.

### 18. Who may change a running product's limits — and is a second person's approval needed?
*(Added 29 September 2026.)* Our software now requires a plain-language before→after review
and a second click before writing any limits change to PDAS, and it refuses an ordinary edit
without a stated reason of at least ten characters. For a *large* change (more than roughly
3% on the setpoint, or more than roughly 20g on either tolerance) it currently also demands a
longer reason and an extra confirmation — **but 3%/20g are our own placeholder numbers, not
numbers you have approved.** Two things we need from you: (1) is a single person's click
enough, or does a limits change need a second person's sign-off before it takes effect; and
(2) what change size should actually trigger the "this is unusually large, are you sure"
step — tell us a number, or tell us the 3%/20g placeholder is fine as it stands.

**Blocked without it:** nothing today — the placeholder guard is safe (if anything,
over-cautious) either way. This becomes urgent only once PDAS writes are enabled at the
plant, which is still gated on the local proof and your written authority (already given
19 Sep 2026, see `DEFECTS.md` D-12) plus the plant-side rehearsals in `handover/`.

### 19. How and when does the PLC actually pick up a changed limit from PDAS?
*(Added 29 September 2026 — restates a question this project has asked in other words
before, gathered here because it is now the single biggest gap in what our software can
honestly claim about a limits change.)* Our software writes a new limit to PDAS's own table
the moment someone confirms the change, and the screen currently states this as if it were
the whole story. We do not know whether the scale then picks it up immediately, at the next
product change, only after a restart, or not automatically at all. Until we know, our own
sentence describing "the limit is now in force" is a guess dressed as a fact.

**Blocked without it:** nothing breaks today, but the screen may be telling your engineers
something that isn't true.

**Cost of staying blocked:** an engineer who trusts our screen instead of checking the
machine could run a shift against the old limit without knowing it.

### 20. Should SMS correct the Shift column, or reproduce your vendor screen's version of it?
*(Added 29 September 2026 — restates open item #7's underlying question in the specific
terms our own report footnote now states on every report.)* We already told you (§7) that
your `Shift` column is derived from when a row was *inserted*, not when the cone was
actually produced, and that our reports now compute shift from production time instead —
which means **our shift totals will not match your own PDAS/vendor screens for the same
day.** Every report we produce now says this in one sentence, so nobody is surprised by it.
The question we still need answered: do you want us to keep computing the *corrected* shift
(ours), or to deliberately *reproduce* your vendor screen's version (including its known
quirk) so the two systems agree, even though one of them would then be knowingly wrong?

**Blocked without it:** nothing — we default to the corrected version, stated as such.

**Cost of staying blocked:** every parallel-run comparison against your own figures (see
`handover/FAILURE-ANALYSIS-2026-09-29.md`'s go-live condition G6) will show a shift-boundary
difference that has to be re-explained each time, instead of settled once.

### 21. Retention, a warning before a table rebuild, and locking down `dbo.Users`
*(Added 29 September 2026 — three small, previously-scattered asks gathered into one
item.)* Three separate things we need a decision on, none urgent on its own:

- **How long should SMS keep raw and canonical readings** against SQL Server Express's 10 GB
  cap? At the measured rate this is years away, not months, but it is still your call, not
  ours to assume (this project's own working rule).
- **Will you warn us before your team drops and recreates a weighing table**, the way it did
  on 5 August 2026? That rebuild is what created the July/September split this whole gap
  question is about; a few minutes' warning next time would let us close the generation
  cleanly instead of discovering it after the fact.
- **May we ask for `DENY SELECT` on `dbo.Users`** for whatever read-only login you provision
  for us? That table holds three accounts with plaintext passwords equal to the usernames
  (`CLAUDE.md`'s own Security section already flags this); we have no use for it and would
  rather be structurally unable to read it than rely on our own discipline not to.

**Blocked without it:** nothing today for the first two; the third is a small hardening step
we can ask for regardless of your answer, since it costs you nothing to grant. UPS
confirmation is item 12 above, not repeated here.

---

## Tier 5 — The eight reports you asked for on 29 September

**DRAFT — written 1 October 2026, NOT SENT.** On 29 September 2026 IFL listed eight reports by
email. All eight are built, under IFL's own titles. Each one rests on a few readings of your words
and on defaults we applied because your data or your email did not settle them. **Every one of
those is printed on the report itself** — screen, paper, CSV and workbook — under the heading
**"Assumed until IFL confirms"**, and every one is asked below. Numbers quoted here were
re-measured on 1 October 2026, read-only, against the development copy of your databases (the
June–July and August–September samples), not copied from an earlier draft. **Nothing in this tier
stops a report from printing:** each item says what we built meanwhile, and a different answer
changes a definition, not whether the report exists. The definitions themselves are
`KPI-DEFINITIONS.md` §2.2 (rows 33–64).

*(Numbered 22–29 so items 1–21 keep the numbers other files cite. This tier is not in the covering
note at the top; send it with that note or as a second message. **Internal, delete before sending:**
this replaces a first draft of items 22–29 written earlier on 1 October that put one question under
each report. The numbers are the same, the subjects are regrouped by theme, so the "Asked in"
column of `KPI-DEFINITIONS.md` §2.2 must be re-pointed to the map below.)*

| Your report | Settled by questions |
|---|---|
| Shift-wise CTS Loop Production Report | 22, 23, 24 |
| Rejected Sack Report - Daily | 22, 26, 28 |
| SPS Production Report - Count-wise Packing at Each SPS | 22, 23, 28 |
| SPS Sack Weight Range Report | 27 |
| Sack Packing Weight Summary | 22, 27, 28 |
| List of Rejected Cones Against Weight | 25 |
| Rejected Cone Hangers Report | 23 |
| Rejected Unknown (Lifter) Report | 29 |

### 22. What do "SPS", "CTS loop" and "count" mean on your report titles?
*(Added 1 October 2026, DRAFT. Reports: Shift-wise CTS Loop, SPS Production, Rejected Sack, Sack
Packing Weight Summary.)* Three words in your email are not in your database, so we read them from
context and say so on the page:

1. **SPS.** Your data holds **one** sack scale (`PLC_sack1`) and one cone PLC (`PLC_pack1`). We
   take "each SPS" to mean each sack scale, so the SPS report shows a single block, "SPS 1 — this
   line's one sack scale (PLC_sack1)", marked unconfirmed. The archives you sent us were also named
   "SPS…": is SPS the name of the whole weighing-and-packing system, rather than a machine?
2. **CTS loop.** We take it to be the conveyor loop that carries the cone hangers: one loop,
   hangers numbered 1–299, shared by all 14 winders (see item 23 for a wrinkle in those numbers).
   The Shift-wise report is therefore one block that states how many hanger numbers the period
   saw. What does CTS stand for, and is there more than one loop?
3. **Count**, as in "count-wise packing". We read it as the **yarn count**. A sack carries a
   product number; we turn it into a yarn count through today's product master (PDAS), so a count
   edited in PDAS later would change how older sacks print. Is one product exactly one yarn count,
   and is today's master acceptable — or should a sack keep the count it had when it was packed?
   For 5 August – 7 September 2026 the result is: count 36 — 2,197 sacks; 18 — 2,013; 30 — 862;
   50 — 243; 20 Slub — 79; 36 Slub — 40; and one sack with no product. Are those the counts you ran?

**Built meanwhile:** all three readings above, printed on the reports. A sack with no product on
its record (every July sack — see item 28) goes under "No product on the reading"; we never guess
a count for it.

**Blocked without it:** nothing. **Cost of staying blocked:** if an SPS is something else, the SPS
report shows one block where you expect several, or groups by the wrong thing.

### 23. How many sack scales and hanger loops does TP1 have — and at what reject rate should a hanger be looked at?
*(Added 1 October 2026, DRAFT. Reports: SPS Production, Shift-wise CTS Loop, Rejected Cone
Hangers. The sack-scale half is item 13 asked again in report terms.)*

- **Sack scales.** One is recorded (`PLC_sack1`). Is that every sack-packing machine on TP1, or
  are there others whose sacks do not reach this database?
- **Hanger loops, and a wrinkle in the numbers.** We find one loop, hangers 1–299, shared by all 14
  winders (one lifter each). But the two samples differ. In July all 299 positions carry cones
  (hanger 299 carried 414 of them). Since 5 August the data holds hangers 1–298 only: hanger 299
  appears once, on a record stamped 12 July 2026, which is a clock fault. And five hangers — **78,
  106, 117, 268 and 297** — do not appear at all between 5 and 29 August; they first appear on
  30 August (293 distinct hanger numbers on 5–29 August, 298 from 30 August). Is the loop now 298
  positions or 299? Were five hangers out of the loop for those 25 days, and is hanger 299 gone?
- **A reject rate worth acting on.** The Rejected Cone Hangers report needs a rule for "look at this
  hanger". For 5 August – 7 September the line as a whole rejected 4.59% of the cones inspected;
  hanger 91 had 58 rejects on 471 cones, about 12%. Our default flags a hanger as **"stands out in
  this period"** only when its reject count is unlikely at the line's own rate (an exact binomial
  test at 5%, allowing for the number of hangers tested), and judges only hangers with at least 100
  inspected cones — below that the page says "too few cones to judge". The page never says a hanger
  is "bad" or "faulty": a count shows where rejects were, not why. **Do you have your own rule — a
  rate, a count, a number in a row — and do you count quality and weight rejects together?** We
  count both; we would rather use yours.

**Built meanwhile:** the default flag above, and the 298/299 question stated on the report when a
period shows it.

**Blocked without it:** nothing. **Cost of staying blocked:** the flagged hangers may not be the
ones your engineers already watch, and a five-hanger gap in August may be read as a data fault when
it was a physical change.

### 24. Shift-wise CTS loop production: what is "Total", what is a "weight rejection", and is the weight gross or net?
*(Added 1 October 2026, DRAFT. Report: Shift-wise CTS Loop Production.)* Three one-line answers
settle this report. Shifts are by production time, not by your `Shift` column (item 20).

1. **Total.** A cone rejected on weight appears in your data **twice**: once as a weighed cone and
   once as a weight-reject record, with the same time and hanger (all 41 in the September
   generation; 244 of the 246 in July). We count each such cone **once, as a reject**:
   *Pass* = weighed cones with no weight-reject record, *Total* = Pass + Weight rejects,
   *Efficiency* = Pass ÷ Total. For 3 July 2026: 7,923 cones weighed, one of them weight-rejected,
   so Pass 7,922, Total 7,923, Efficiency 99.99%. On your own sheet, does such a cone count under
   Pass, under Weight rejects, or under both? (Under both, that day's Total would be 7,924.)
2. **"Weight rejection".** We use the weight-reject records. The scale also sets its own in-range
   bit on each cone, and that marks a different, larger set: 419 cones in July against 246 records,
   53 in the September generation against 41. We print the bit's count beside the records as a
   separate fact and never merge them. Which one does your sheet mean?
3. **Kilograms.** The weighed-kg figure is the total of the cone weights on the basis set in Setup
   — currently **gross** (the cone with its tube), which was set from your 15 September answer
   about sacks and extended to cones as a placeholder (item 6) — leaving out readings outside
   1,500–2,100 g, whose number is printed. Do you want gross, or net of the tube?

**Built meanwhile:** all three defaults, printed on the report; a Total that equals the number of
physical cones plus the weight rejects that have no cone row.

**Blocked without it:** nothing. **Cost of staying blocked:** the first parallel run against your
own sheet differs by exactly the cones in question and has to be re-explained each time.

### 25. List of rejected cones against weight: which columns, what "over/under" means, and do quality rejects belong?
*(Added 1 October 2026, DRAFT. Report: List of Rejected Cones Against Weight.)*

The list holds **weight rejects only** — cones the weighing scale rejected — one row each: date,
shift, time (plant clock), winder, hanger, weight, product, the product's limits as they stood at
that moment, and how far outside them: a signed number of grams, minus below the lower limit, plus
above the upper. A cone the scale rejected that is *inside* its product's own limits is marked
"inside the product's limits" — the scale's flag and the product's limits are different things and
can disagree. Where we cannot date the limits we say "recorded no later than" and the date. A
record stamped 1 January 1970 (weight id 153, 0 g) is left off and counted in a footnote.

Questions: are those the columns you expect, and is "over/under" wanted in grams or in percent? Are
the limits the product limits held in PDAS (what we use), or the scale's own? And **should quality
(inspection) rejects be on this list** — a far larger population (6,049 in the September generation
against 41 weight rejects; 2,900 against 246 in July) that today lives on the Rejects screen and the
Rejects report — on the same list, on a second list, or not at all?

**Built meanwhile:** weight rejects only, with the reason printed under the list.

**Blocked without it:** nothing. **Cost of staying blocked:** a list that is shorter than the one
you expected.

### 26. Rejected sack report, daily: what counts as a rejected sack, and what does "daily" mean?
*(Added 1 October 2026, DRAFT. Report: Rejected Sack Report - Daily.)* Your data holds **no sack
tolerance anywhere**, so we cannot call a sack under- or over-weight, and we do not. We call a sack
*rejected* when **the sack scale itself marked it out of range**. That includes a reading of 0 kg
or another fault value: 594 of 5,435 sacks in the September generation (four of them outside
40–60 kg, listed apart as "implausible weight") and 231 of 5,462 in July (three). Every sack has the
scale's flag, so none is counted as a pass by default. "Daily" we take to mean **per production day
(06:00 to 06:00, plant clock), split into the three shifts**; a sack's time is when the plant
*saved* the record (item 15), because the sack scale keeps no time of its own. We print the range
the scale *passed* as a plain fact — 47.0–47.6 kg since 5 August — never as a limit.

Is that the meaning you want? Does a 0 kg or fault reading belong on the list (see item 16), and do
you apply a sack tolerance on paper that we should be using instead?

**Built meanwhile:** the scale's own verdict, said to be the scale's, with a day-by-shift table, a
split between implausible and plausible rejected weights, and a list of every rejected sack.

**Blocked without it:** nothing. **Cost of staying blocked:** if you hold a tolerance we do not
know of, a "rejected" sack here may not be one on your own sheet.

### 27. Sack weight: is there a target and tolerance per product, which bands do you want, and which conventions?
*(Added 1 October 2026, DRAFT. Reports: SPS Sack Weight Range, Sack Packing Weight Summary.)*

- **Target and tolerance.** No target or tolerance is held anywhere in your data. All we see is what
  the scale passed: **47.0–47.4 kg in July and 47.0–47.6 kg since 5 August**. The heaviest sack the
  scale passed was 47.4 kg on count 36, 47.5 on count 30 and 47.6 on count 18, which may mean it
  applies a different upper limit per product, or may only reflect what was packed. Is there a
  target weight and a tolerance for each product, and what are they?
- **Bands.** The range report groups sacks in **0.1 kg bands** from just below the lightest sack
  the scale passed to just above the heaviest (0.2 kg if that would make more than 30 bands), with
  open-ended rows at both ends and a row for implausible weights; each band is split by the scale's
  verdict and by shift. **No band is marked as a target.** Is 0.1 kg the width you want, or do you
  work to fixed bands of your own?
- **The summary's conventions.** (a) We print the *sample* standard deviation (divided by n − 1);
  does your sheet divide by n? (b) Average, lightest, heaviest and standard deviation leave out
  sacks outside 40–60 kg (scale faults, 0 kg readings), and the number left out is printed; is
  40–60 kg right for a filled sack? (c) Weights are **gross**, as you told us on 15 September; if
  you also want net, what does an empty sack weigh? (Our 0.5 kg is a placeholder you have never
  seen, item 6.)

**Built meanwhile:** all of the above as defaults, printed on both reports.

**Blocked without it:** nothing. **Cost of staying blocked:** low — a range report with no target
line on it, and a spread that differs from yours in the third decimal if your convention is
dividing by n.

### 28. Did sacks carry a product number before 5 August — and is it really the product?
*(Added 1 October 2026, DRAFT. Reports: SPS Production, Rejected Sack, Sack Packing Weight Summary.
Related: items 9 and 17.)* The yarn-count columns depend on the product being on the sack record.
**None of July's 5,462 sacks has one; 5,434 of the September generation's 5,435 do.** The column
appeared in the 5 August rebuild, and the tag that feeds it is named `S1_Sack_Quality`. Its values
are exactly your product numbers (20, 21, 1021–1024), so we treat it as the product — but the
tag's name says "quality". Please confirm it is the product the sack was packed from, not a
quality grade. And for the period before 5 August: was the product recorded for sacks anywhere
else (another table, the PLC, a paper record), or did the column simply not exist until the
rebuild? The 10 July – 5 August data asked for in items 9 and 17 would show which. If it was not
recorded, may we assign earlier sacks to the product PDAS says was running, clearly labelled as
inferred? We have **not** done so.

**Built meanwhile:** earlier sacks print under "No product on the reading" in every count-wise
figure; the reports say how many sacks that affects.

**Blocked without it:** nothing. **Cost of staying blocked:** every July count-wise figure is one
undivided "No product" column.

### 29. Rejected unknown (lifter): what does "unknown" mean?
*(Added 1 October 2026, DRAFT. Report: Rejected Unknown (Lifter) Report. This is the one report
whose definition is ours, not yours.)* We could not find a rejected cone in your data whose lifter
is "unknown" in any ordinary period:

- On TP1 the lifter number equals the winder number on all but four of the 275,063 cones we hold
  (99.9985%): two zeroed-clock records with no winder number, and two ordinary cones where the two
  differ (winder 1 with lifter 9 on 23 June; winder 3 with lifter 5 on 7 August). On a rejected cone
  they never differ. **Is a lifter the same thing as a winder on this line, and what are those two
  ordinary cones?**
- The only real rejects with no lifter number are three records stamped 1 January 1970, a zeroed
  clock: July quality id 81 and weight id 153, September quality id 1248. No period picker can
  reach them, so the report shows them in a separate block that ignores the period.
- **Reason code 0.** Thirteen quality rejects (five in July, eight in the September generation)
  carry a 0 in the tube or material reason code, six of them in both. Is 0 "no reason recorded",
  or a real reason?
- **No reject code has a name.** You told us on 15 September that the codes have no fixed list and
  would be named in Setup. None of the twenty codes there has a name yet, so every reason shows as
  a raw number.

Our **draft** definition is: *a reject with no lifter number or no winder number recorded, and
nothing else.* A reject with a zero reason code is counted and listed apart, not called unknown.
What did you mean — no lifter recorded, a zero reason code, a lifter that could not be identified,
something your own screen shows? A screenshot of the report you have in mind would settle it.

**Built meanwhile:** per lifter 1–14 and "No lifter recorded": cones, cones inspected, quality
rejects (of which with a zero code), weight rejects, total and rate; a list of the qualifying
rejects with the reason each qualifies; the zeroed-clock block (two records for July, one for
September); and, when nothing qualifies, one sentence — "Every rejected cone in this period
carries a lifter number."

**Blocked without it:** nothing. **Cost of staying blocked:** the report is correct to its own
words and may not be the report you meant.

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
| "Sack stock per machine"? | Sack production per machine, by shift and by day *(what the data allows, built: cone production per machine by shift and day, and sack production at line level; the sack scale records no machine, so there is no per-machine sack figure)* |
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
