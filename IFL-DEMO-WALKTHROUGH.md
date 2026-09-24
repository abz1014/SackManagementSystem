# IFL demo walkthrough

**Reconciled against IFL's answers of 15 September 2026 on 23 September 2026.** The first
version of this walkthrough, written 22 September, asked IFL nineteen questions Hassan sb had
already answered a week earlier — Q1, Q3, Q10, Q12, Q19, Q24, Q28, Q33, Q34, Q35, Q36, Q37,
Q40, Q41, Q44, Q45, Q46, Q47 and Q48. Every one of those has been removed and replaced by
what the answer was and what it changed in the software. **Asking a client to repeat
themselves is the fastest way to prove nobody read their reply.**

**Purpose.** Two things at once: find out whether the rebuilt interface answers IFL's
September objection, and — for the fifteen things still genuinely open — get answers in the
room instead of by email.

**Audience.** The GM, managers and process engineers of the process department — one
technical audience (confirmed 2 Sep 2026). A process engineer reads a control chart without
help. Do not simplify the content; the objection was never that it was too advanced.

**What IFL actually said in September:** too complicated, nothing live, unclear what period
any number described, and per-sack / per-cone detail buried. All four were true in the code.
The walk below is ordered to answer them in that order, because that is the fastest way to
find out if the rebuild worked.

**The second story this demo now tells, and it is the more valuable one:** *we asked you
you answered our questions on 15 September, and here is each answer built into the software.* Say it
explicitly at the start. Most of the walk below is now a demonstration of that, not a
question list.

**Time.** 40 minutes of walking, then the asks. Do not run over.

---

## Before you start

**Data.** The app will be running on the September sample: 5 Aug – 7 Sep 2026, 132,552 cones,
5,435 sacks. Say this out loud at the start. It is IFL's own data, so every number on screen
is theirs and they can challenge it — that is a feature of the demo, not a risk to manage.

**Make it move.** The sample ends 7 Sep, so on today's clock every live screen correctly
reports that nothing is arriving. That would reproduce the "nothing live" complaint for the
wrong reason. Use the replay parameter to move the plant clock back into the data:

```
?at=2026-09-07T10:00:00Z
```

The screen banners itself as a replay whenever this is on. **Leave the banner visible and
point at it.** Showing a replay honestly is worth more than a demo that looks live and isn't —
and this audience will ask.

**Set the period explicitly** on any screen you are not demonstrating live: use the period
control, or `?p=pick&from=2026-08-05&to=2026-09-07`. Never leave it on a default that shows an
empty period.

**Have ready:** [`IFL-OPEN-QUESTIONS.md`](IFL-OPEN-QUESTIONS.md) — fifteen asks, not
thirty-six — and a note-taker.

**Have resolved BEFORE the meeting, with the owner:** whether IFL has already granted written
authority for SMS to write to PDAS. Our own records contradict each other on this (see ask 3
in `IFL-OPEN-QUESTIONS.md`). Walking into the room and asking for permission they already gave
is as bad as not asking.

---

## The walk

### 1. Line — "is the line running, what has it made, does anything need attention?"

Open on Line with the replay on. One slim bar, one period control, one sentence about how old
the data is.

**Say:** every screen answers exactly one question, and the question is written at the top of
it. Seven screens, ordered by time window.

**Show:** the shift's output, the attention list, the per-machine strip. Click a KPI — they
are links, and they carry the period with them.

**The point to land:** the September demo had seventeen analysis sub-screens. This has seven
screens, and nothing appears on two of them.

**Their answers, built (do not ask these again):**
- *"Machine and station are the same thing, 1 to 14."* The two separate concepts are gone —
  one machine list, on this strip and in Setup.
- *"The dashboard should show live data, today, the shift, and machine problems."* That is
  exactly the order of this screen: freshness line, the shift's output, today, then the
  attention list.

### 2. The freshness line — the "nothing live" answer

Point at the sentence reporting how old the data is, and at the replay banner.

**Say, and do not soften it:** this software never sees the present. IFL's own acquisition
layer writes a cone's row about **18 minutes** after the cone is weighed — measured at 909 s
minimum and 1,090 s mean over 142,509 rows of their data. Every live screen is judged against
that lag rather than the wall clock, which is why it does not claim the line has stopped when
it has not.

This is the single most credible thing in the demo, because it is a fact about *their* plant
that they can verify and that a vendor could only know by measuring.

**Their answer, built:** *"as soon as possible"*, and the source's own delay is accepted. The
screens poll every ten seconds and state the lag rather than hiding it. Nothing to ask here.

### 3. The period control — the "unclear what period" answer

Change the period once and let every number on screen move with it.

**Say:** one control, every screen, and it is in the URL — so a link to a screen is a link to
that screen *for that period*, which is what makes a number in an email checkable.

### 4. Readings — the "detail was buried" answer

Open Readings and then open a single cone.

**Show:** the reading sheet — the row's own product, its own limits at its own time, the
scale's own pass/reject flag as a separate named fact, and *Where this reading came from*:
source table, source row id, generation, and the sync pass that read it.

**Say:** any number anywhere in the app can be traced to the row it came from.

**Their answers, built:**
- *"There is no predefined list of reject codes — they are set in the settings."* Show
  Setup › Reject codes. The labels are blank on screen because **IFL has not typed them in
  yet**, not because we are waiting on a list. Offer to fill in whichever ones they can name
  in the room — that turns a blank column into a demonstration.
- *"The limits should be changeable in the settings, there is no fixed limit."* Built: the
  engineer can set a limit in SMS without touching PDAS, and every reading is judged by the
  limits in force at its own time, not today's.

**Ask here — one thing, and it is new:**
- **What limits were in force before September?** Show that an August report deliberately
  refuses to state a target. Explain why: our limit history begins at one instant on 11
  September, when the software first read PDAS. Nothing earlier exists anywhere but at IFL.
  *(Ask 4 in the open-questions list.)*

### 5. Weight — the calibration machinery

Show the control chart, the station table, and one station's drift.

**Say carefully, because this is where over-claiming is tempting:** weighing data cannot
distinguish a heavy scale from heavy cones. The app therefore never says "reduce station 7 by
9 g". It says which station is drifting, by how much, and — where the trend supports it —
roughly how many days until it reaches the action limit at the current rate.

**Their answer, built:** *"study the data and tell us"* — recommendation only, never an
automatic machine adjustment. That is precisely what this is. **Do not call it AI.** Hassan
left open whether this satisfies the "AI" line in the quotation; that is a conversation to
have deliberately, not a word to slip into a demo.

**Ask here:**
- **49/50.** Do you have any records of past calibrations, and weights before and after?
  *(We concluded none exist, from their absence in everything you sent. A yes would let the
  advisory be validated against reality — so this is worth one minute even though we think we
  know the answer.)*
- **Cone weight basis.** Does the 1,960 g target include the tube? Your answer about sacks —
  "the total weight of the sack" — settled sacks; the same setting governs cones, and we would
  rather ask than assume. *(Ask 6.)*

### 6. Product — changeover, their own stated key requirement

Open Product › Running, then Changeover.

**Say:** on 15 September Hassan sb named this as the key requirement, with his own example —
machine 1 runs product A on the morning shift, the engineer changes it so the evening shift
runs product B, and the reports show which product ran on which machine in which shift.
**Show the tenth report type, *Product by machine and shift*, which exists because of that
answer.** Then show the changeover workflow: pick blend, count, tube type, limits, pallet;
the system plans the exact sequence of vendor procedures it would run, checks the uniqueness
rule PDAS enforces, and shows every blocker before anything happens.

**Their answer, built:** *"the process engineer on the floor"* changes products, limits and
sack figures. One role, called engineer, does all three. Show that the same account that can
plan a changeover is the one that can set a limit.

**Then show the execute button disabled, and say why.** SMS will not write to PDAS until our
own local end-to-end proof has passed. The plan is real; the write is off by choice.

**Say here:** thank them for the written permission given on 19 September. Confirm the nine
rights back to them: `Materials`, `Blends`, `Counts`, `TubeTypes`, `Pallets` and `nhs_events`,
no new objects, no DELETE, no other table. Say it will be switched on once our own local
end-to-end test has passed.

### 7. Report — now the best-answered section, not the most open one

Open Report and show three or four of the **ten** types, the Excel workbook and the PDF.

**Their answers, built — this section is where the 15 September meeting shows most:**
- *"Every report, every day and every shift."* Ten types, each with a daily and a shift basis.
- *"Excel AND PDF, beautiful, with graphics."* The Excel workbook carries real charts and
  data bars, not just a grid of numbers; the PDF is generated by the server, not by the
  browser's print dialog. **Open both in front of them.** This is the one item on the whole
  list where IFL's judgement — is it good enough? — genuinely cannot be answered by us.
- *"No automatic emailing."* The software sends no mail at all, which is now correct rather
  than merely unbuilt.
- *"Sack weight is the total weight of the sack."* Applied the same day it was given; every
  sack figure on every report is on that basis.

**Ask here — one thing:**
- **The KPI definitions sheet.** 32 rows: what each number means, what it is divided by, which
  clock it uses, what it excludes. Every row says "awaiting IFL approval". Hand it over, or
  walk one page of it. *(Ask 5.)*

### 8. Sacks — the reframed module, and the honest limitation

Show the Sacks screen in its own order — the period's figures first, then **the same figures
by shift and by product**, and only then the stock ledger and the sack history (verified
against `web/src/screens/Sacks.tsx`, 23 Sep 2026). The per-day view is on the reports, not
this screen.

**Their answer, built, and it changed this module:** *"sack stock for each machine" means sack
production per machine by shift and day, with all relevant information* — a production report,
not a receipts-and-issues ledger. We had been building the ledger; their answer moved it to
second place and put production first.

**Say plainly what still cannot be done, because it has not changed:** the sack table IFL
supplied carries no machine or station column, so sack production *per machine* is not
computable from this data by anyone. Per shift, per day and per product is — and that is what
the screen leads with. The gap is in the source data, not in the software.

Also flag honestly: the cones-between-sacks figure is approximate. The plant records no key
from a cone to its sack, and the count between consecutive sacks ranges 0–250. The screen says
so. It is not a packing list.

**Ask here — one sentence, and only to confirm it is moot:**
- Do you still want a manual sack ledger (receipts, issues, adjustments) on top of the
  production report? If not, we can stop asking about sack types and codes altogether.
  *(Ask 14.)*

### 9. Health — why they should trust the numbers

Show sync status, the data-quality findings grouped by table, the source generations, and the
last reconciliation line.

**Say:** when the system cannot reach the source it says so, rather than reporting zero. The
findings list is the app auditing its own inputs. And this line records the last time SMS
reconciled itself against IFL's own database, naming which database it ran against.

**Point at the generations table.** It shows their 5 August rebuild as a separate generation —
142,510 cones in the old one, 132,551 in the new (re-counted 23 September 2026). Then:

**Ask here:**
- **55.** Does data older than August still exist in your backups?
- And lead from this screen straight into the asks below — the gap between the two generations
  is visible on it.

### 10. Wall — thirty seconds, if there is a screen

Fullscreen board, no navigation, readable across a room.

**Ask here:**
- **67.** Is there a PC or display near the production floor? *(Without one this is built and
  unseen.)*

---

## The asks, before anyone leaves

Four things. Everything else on the list can go by email; these cannot.

1. **The 10 July – 5 August data.** Re-measured 23 September 2026: the July sample's last cone
   is 10 July 11:23; the September sample's first real production row is 5 August. Twenty-six
   days exist only at IFL. **This has never been formally requested.** It is the one item on
   the whole list that gets worse with time — IFL keeps about a month.
2. **A read-only login on the live server, the host name, and confirmation that the PC we
   supply can reach it.** This is what turns the demo into an installation. The script their
   DBA runs is ready and unchanged.
3. **PDAS write authority: thank you, and formal written confirmation back.** Permission was
   given on 19 September, covering all nine rights across `Materials`, `Blends`, `Counts`,
   `TubeTypes`, `Pallets` and `nhs_events`. No new objects, no DELETE, no other table. We ask
   IFL to confirm this back to us in writing, and we will provision and switch it on once our
   own local end-to-end test has passed.
4. **How much history can be provided** — 6 months, 12 months, everything? Six months is the
   minimum before any predictive work is honest; we hold 53 production days.

---

## What not to say

- **Do not ask anything Hassan answered on 15 September.** The full list of what was answered
  is at the end of `IFL-OPEN-QUESTIONS.md`. Nineteen of them were in the first draft of this
  walkthrough and have been removed.
- **Do not promise AI.** The calibration advisory is statistics — control rules, drift, a
  linear projection. It is defensible when challenged, which "AI" is not. Hassan explicitly
  left open whether this satisfies the quotation's AI line; raise that as its own conversation.
- **Do not present sack stock per machine as achievable** from the current data. It is not,
  and their own answer moved the requirement to something that is.
- **Do not claim anything about OEE, availability or shift-versus-shift.** No requirement asks
  for it and it was deliberately removed.
- **Do not say the weight comparison is settled.** Sacks are settled (gross). Cones are not —
  the same setting was applied to both on the strength of an answer about sacks.
- **Do not claim it has run on the plant.** Nothing in this demo has been verified against live
  plant data — only against the two samples IFL sent. Every measurement quoted in this
  document comes from those copies on a development machine.
- **Do not say a PDAS procedure has been tested against a database.** None has ever been
  executed against any database, local or plant.

---

## Afterwards, the same day

Write the answers into `IFL-QUESTIONS-STATUS.md` with the date and who said it, while the room
is still fresh, and refresh `IFL-OPEN-QUESTIONS.md` from it. Answers recorded a week later are
answers half-remembered — and this walkthrough is itself the proof of what happens when
answers sit unrecorded: the 15 September answers went eight days without reaching the question
list, and the first draft of this document re-asked nineteen of them.
