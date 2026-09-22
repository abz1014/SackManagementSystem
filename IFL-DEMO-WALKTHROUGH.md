# IFL demo walkthrough

**Purpose.** Two things at once: find out whether the rebuilt interface answers IFL's
September objection, and get the open questions answered in the room instead of by email.

**Audience.** The GM, managers and process engineers of the process department — one
technical audience (confirmed 2 Sep 2026). A process engineer reads a control chart
without help. Do not simplify the content; the objection was never that it was too
advanced.

**What IFL actually said in September:** too complicated, nothing live, unclear what
period any number described, and per-sack / per-cone detail buried. All four were true
in the code. The walk below is ordered to answer them in that order, because that is the
fastest way to find out if the rebuild worked.

**Time.** 40 minutes of walking, then the asks. Do not run over — the asks are the part
that unblocks four waves of work.

---

## Before you start

**Data.** The app will be running on the September sample: 5 Aug – 7 Sep 2026,
132,552 cones, 5,435 sacks. Say this out loud at the start. It is IFL's own data, so
every number on screen is theirs and they can challenge it — that is a feature of the
demo, not a risk to manage.

**Make it move.** The sample ends 7 Sep, so on today's clock every live screen correctly
reports that nothing is arriving. That would reproduce the "nothing live" complaint for
the wrong reason. Use the replay parameter to move the plant clock back into the data:

```
?at=2026-09-07T10:00:00Z
```

The screen banners itself as a replay whenever this is on. **Leave the banner visible and
point at it.** Showing a replay honestly is worth more than a demo that looks live and
isn't — and this audience will ask.

**Set the period explicitly** on any screen you are not demonstrating live: use the
period control, or `?p=pick&from=2026-08-05&to=2026-09-07`. Never leave it on a default
that shows an empty period.

**Have ready:** the 36 open questions, and a note-taker. Most of section F and E below
will be answered verbally and you will not remember them afterwards.

---

## The walk

### 1. Line — "is the line running, what has it made, does anything need attention?"

Open on Line with the replay on. One slim bar, one period control, one sentence about how
old the data is.

**Say:** every screen answers exactly one question, and the question is written at the
top of it. Seven screens, ordered by time window.

**Show:** the shift's output, the attention list, the per-machine strip. Click a KPI —
they are links now, and they carry the period with them.

**The point to land:** the September demo had seventeen analysis sub-screens. This has
seven screens, and nothing appears on two of them.

**Ask here:**
- **35.** What should management see on this screen first?
- **1.** Fourteen Rieter winders — confirm.
- **3.** Do the machines have stations, spindles or heads that need identifying separately?

### 2. The freshness line — the "nothing live" answer

Point at the sentence reporting how old the data is, and at the replay banner.

**Say, and do not soften it:** this software never sees the present. IFL's own acquisition
layer writes a cone's row about **18 minutes** after the cone is weighed — measured at
909 s minimum and 1,090 s mean over 142,509 rows of their data. Every live screen is judged
against that lag rather than the wall clock, which is why it does not claim the line has
stopped when it has not.

This is the single most credible thing in the demo, because it is a fact about *their*
plant that they can verify and that a vendor could only know by measuring.

**Ask here:**
- **44.** How quickly must new production data appear?
- **45.** State rather than ask: with an 18-minute acquisition lag, the display cannot be
  fresher than the source. Confirm that is acceptable.

### 3. The period control — the "unclear what period" answer

Change the period once and let every number on screen move with it.

**Say:** one control, every screen, and it is in the URL — so a link to a screen is a link
to that screen *for that period*, which is what makes a number in an email checkable.

### 4. Readings — the "detail was buried" answer

Open Readings and then open a single cone.

**Show:** the reading sheet — the row's own product, its own limits at its own time, the
scale's own pass/reject flag as a separate named fact, and *Where this reading came from*:
source table, source row id, generation, and the sync pass that read it.

**Say:** any number anywhere in the app can be traced to the row it came from.

**Ask here:**
- **12.** What does each reject code mean? *(the labels are honestly blank until they tell you)*
- **10.** Who decides the ± weight limits?

### 5. Weight — the calibration machinery

Show the control chart, the station table, and one station's drift.

**Say carefully, because this is where over-claiming is tempting:** weighing data cannot
distinguish a heavy scale from heavy cones. The app therefore never says "reduce station 7
by 9 g". It says which station is drifting, by how much, and — where the trend supports it
— roughly how many days until it reaches the action limit at the current rate. That is a
projection from their data, not a prediction dressed up as AI.

**Ask here:**
- **46.** What does "AI should recommend calibration" mean to you, concretely?
- **47.** Recommendation only, or automatic adjustment of the machine?
- **48.** If automatic, who approves it?
- **49/50.** Do you have records of past calibrations, and the weights before and after?
  *(If yes, this is what would let the advisory be validated against reality.)*

### 6. Product — changeover, their own stated key requirement

Open Product › Running, then Changeover.

**Say:** Hassan sb named per-machine product changeover per shift as the key requirement.
Here is the workflow: pick blend, count, tube type, limits, pallet; the system plans the
exact sequence of vendor procedures it would run, checks the uniqueness rule PDAS enforces,
and shows every blocker before anything happens.

**Then show the execute button disabled, and say why.** SMS will not write to PDAS until
IFL confirms in writing that it may. The plan is real; the write is off by choice.

**Ask here — this is the most valuable minute of the demo:**
- **19.** If SMS may write to PDAS, who is authorised to make those changes?
- **41.** Who should be allowed to change products?
- **40.** Who should be allowed to change product limits?
- And the ask: **written confirmation** that SMS may write to PDAS, naming all nine rights.

### 7. Report — the entirely-open section

Open Report, show two or three of the nine types, and the CSV export.

**Say:** these nine exist and are wired. What they should contain is genuinely open — the
KPI definitions sheet has 32 rows and every one says "IFL approval: awaiting".

**Ask here — section F is entirely unanswered, so get all five:**
- **33.** What reports do you want every day?
- **34.** What every shift?
- **36.** Excel, PDF, or both?
- **37.** Should the system email them automatically?
- **35.** (again, if not answered at Line) What belongs on the management dashboard?

Also settle, because it changes report wording everywhere:
- **24.** Is sack weight gross, net, or something else?

### 8. Sacks — and the honest limitation

Show the Sacks screen: sacks weighed, kilograms, in-range percentage, cones per sack.

**Say plainly:** the sack table IFL supplied carries no machine or station column. Sack
stock *per machine* is therefore not computable from this data by anyone — not a gap in
the software. It needs either the PLC path that was deferred, or somebody entering it on
the floor.

**Ask here — section E is entirely open and this is the largest missing module:**
- **28.** What exactly do you mean by "sack stock for each machine"?
- **29.** Who would enter receipts and issues?
- **30.** Where is it tracked today — Excel, ERP, on paper?
- **31/32.** Does each sack type have a code, and do different machines use different types?
- **4.** How many sack-packing machines are there?

Also flag honestly: the cones-between-sacks figure is approximate. The plant records no key
from a cone to its sack, and the count between consecutive sacks ranges 0–250. The screen
says so. It is not a packing list.

### 9. Health — why they should trust the numbers

Show sync status, the data-quality findings grouped by table, the source generations, and
the last reconciliation line.

**Say:** when the system cannot reach the source it says so, rather than reporting zero.
The findings list is the app auditing its own inputs. And this line records the last time
SMS reconciled itself against IFL's own database, naming which database it ran against.

**Point at the generations table.** It shows their 5 August rebuild as a separate
generation — 142,511 cones in the old one, 132,552 in the new. Then:
- **55.** Does data older than August still exist in your backups?

### 10. Wall — thirty seconds, if there is a screen

Fullscreen board, no navigation, readable across a room.

- **67.** Is there a PC or display near the production floor?

---

## The asks, before anyone leaves

These four unblock four waves of work. Do not let the meeting end without them.

1. **The 10 July – 5 August data.** Measured today: the July sample ends 10 Jul 11:23 and
   the September sample starts 5 Aug. Twenty-six days exist only at IFL. This has never
   been formally requested.
2. **A read-only login** (`db_datareader`) on both databases, and the target host. This is
   what turns the demo into a live installation. *(Questions 58, 59, 65, 66.)*
3. **Written authority for PDAS writes**, naming all nine rights across `Materials`,
   `Blends`, `Counts`, `TubeTypes`, `Pallets` and `nhs_events`. No new objects, no DELETE,
   no other table.
4. **How much history can be provided** — 6 months, 12 months, everything?
   *(Questions 51–54, 57. Six months is the minimum before any predictive work is honest.)*

---

## What not to say

- **Do not promise AI.** The calibration advisory is statistics — Nelson rules, drift,
  a linear projection. It is defensible when challenged, which "AI" is not. If they press,
  offer the projection as the concrete deliverable.
- **Do not present sack stock per machine as achievable** from the current data. It is not.
- **Do not claim anything about OEE, availability or shift-versus-shift.** No requirement
  asks for it and it was deliberately removed.
- **Do not say the weight comparison is settled** until question 24 is answered. The Weight
  headline deliberately states the mean and the target as two separate facts.
- **Do not claim it has run on the plant.** Nothing in this demo has been verified against
  live plant data — only against the two samples IFL sent.

---

## Afterwards, the same day

Write the answers into `IFL-QUESTIONS-STATUS.md` with the date and who said it, while the
room is still fresh. Answers recorded a week later are answers half-remembered — and four
project documents currently depend on that file being true.
