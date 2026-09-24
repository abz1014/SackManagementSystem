# SMS Operator Manual — for GM, Managers and Process Engineers

This is a plain-English guide to using the Sack Management System (SMS). It
does not assume you write software or SQL. Every number and label below is
taken from the app's own screens and code as they exist today
(24 Sep 2026); anything not yet checked on real plant data is marked
**[UNVERIFIED on plant data]** — everything so far has only been proven
against a local practice copy of IFL's data, never against the live plant.

If a sentence here disagrees with what you see on your own screen, trust
your screen and tell whoever maintains SMS — this manual describes the
system as of today and will need updating as it changes.

---

## 1. Getting started

### Signing in

SMS is a web page opened on a plant PC or browser — there is no separate
app to install. Sign in with the username and password IFL's admin created
for you.

[screenshot — to be captured on site: sign-in screen]

### Roles — what each one may do

There are four roles. Every signed-in account can **see** every screen —
nothing is hidden by role. Roles only control who can **change** something:

| Role | Can view | Can also do |
|---|---|---|
| **Viewer** | Every screen | Nothing else |
| **Engineer** | Every screen | Set the running product, record a calibration adjustment, name/record reasons, change weight limits, run a changeover |
| **Manager** | Every screen | Everything Engineer can, plus export the raw register (CSV) |
| **Admin** | Every screen | Everything above, plus Setup — machines, stations, users, rules |

If a button is missing or greyed out, it is almost always a role limit, not
a fault. The screen tells you what rank is needed (for example, "This
report is for managers and above" on Export, or "Changing products in PDAS
needs a manager account" is currently written as manager-and-up wording but
is enforced as Engineer-and-up in the code — see §7 for the precise gate).

### The period control

Near the top of every screen is one shared control: **Today · Yesterday ·
This shift · Last 7 days · Pick dates**. It sets the time window every
number on that screen describes. Change it once; every block on the screen
updates together. "Pick dates" defaults to the last 7 days, anchored on the
plant's own clock — not your browser's — so a laptop set to the wrong time
zone cannot silently shift what you see.

### "Data is N minutes old" and the ~18-minute lag

Under the top bar there is one sentence stating how fresh the numbers are.
Read it before trusting anything else on the screen. It has three states:

- **Healthy** — a normal age is shown. IFL's own recording equipment writes
  a cone's weight to the database roughly **15–18 minutes** after the cone
  is actually made (measured: about 909–1090 seconds, averaging ~18 minutes,
  over 142,500+ readings). SMS accounts for this automatically — it judges
  whether the line is "running" against *(now minus that lag)*, not against
  the raw clock — so a healthy line will always show as some minutes behind,
  and that is normal, not a fault.
- **The link has gone quiet** — SMS has not heard from the plant's database
  in longer than expected. No screen will claim the line is running or
  stopped while this is showing; it says plainly that it does not know.
- **Readings are arriving far too late to judge by** — data is still coming
  in, but so slowly that "is the line running" cannot be answered honestly.
  Again, no screen guesses.

If you ever see a screen say the line is "Running" or "Stopped", that
sentence up top was in its healthy state at the time. If it was in either
of the other two states, the screen will say it cannot tell, not silently
guess "Stopped".

---

## 2. Screen by screen

Every screen sits behind one shared top bar: **Line · Readings · Weight ·
Rejects · Sacks · Product · Report**, plus a gear icon for **Setup**
(admin only) and your initials for account settings. Every screen also
shows the period control and the freshness sentence from §1.

[screenshot — to be captured on site: top bar with all seven tabs]

### 2.1 Line

**Question it answers:** what is the line doing right now, and what is
each machine making?

- A ribbon of headline figures for the selected period (sacks, cones,
  reject rate, availability as a plain figure — not a full OEE
  calculation; SMS deliberately does not compute OEE, see §9).
- **What is being made** — one row per machine, each machine's most recent
  product, and a per-machine running state (see §5, Machine states).
- Two day tabs (Latest day / Day before) to flip the period quickly.

**Reading the numbers:** every figure is for the period you picked, except
the per-machine "what is being made" block, which is deliberately anchored
on each machine's own newest reading (a rolling two-hour window), not on
the period control — so it can tell you what's running *right now* even
if you're looking at yesterday's period. The screen states this window
explicitly.

**What "—" or "could not read" means:** a dash means that particular figure
could not be fetched (a partial failure), not that the true value is zero.
The screen names which part failed rather than showing one blanket error
for the whole page — if only the reject count failed to load, only the
reject tile says so; the rest of the ribbon keeps working.

**Common questions:**
- *"It says a machine is quiet — is it broken?"* Not necessarily — see the
  machine-state definitions in §5. "Quiet" simply means no cones counted
  in the recent window; it could be a genuine stop, a changeover, or a
  scale issue.
- *"Why does the ribbon disagree with the Report screen for the same
  dates?"* It shouldn't — the reject-rate double counting that caused this
  in earlier builds was fixed 23 Sep 2026 across Line, Weight, Rejects and
  Report; all four now compute the rate the same way (see §9).

[screenshot — to be captured on site: Line screen]

### 2.2 Readings

**Question it answers:** the full cone-by-cone register — every reading
recorded, for audit or investigation.

- A plain table: production time, cone weight, in/out of range (the
  scale's own verdict), the product in force at that instant if known.
- A Print button prints the visible register with its own attribution
  block (line, period, generated-at, operator, SMS version) — see §8.

**Reading the numbers:** "in/out of range" here is the **scale's own**
pass/fail bit — a single, separately-named fact from the product's
tolerance (see §4, "one status vocabulary"). A reading only shows a
tolerance comparison when a product was actually recorded as running at
that reading's own time — never today's tolerance applied to old data.

**What "—" means:** a row with no product shown means no product was
recorded for that machine/time — usually because it predates the plant
adding product-tracking to its own database (5 Aug 2026), or because
`MaterialId` genuinely was not stated. It is not an error.

**Common questions:**
- *"Can I print this and it'll show who ran it and when?"* Yes — unlike
  earlier builds, if the print attribution details fail to load, the
  printed page still states the line, title and period from what's on
  screen, plus a plain sentence naming what could not be confirmed. It
  never substitutes your browser's clock for the plant's.
- **Known gap, not yet fixed:** Readings' Print button does not check
  whether the table has finished loading or failed before printing —
  unlike Report's Print button, which does. If you print immediately
  after opening the page, wait for the table to finish loading first.

### 2.3 Weight

**Question it answers:** is cone weight in control, station by station.

- The line-wide mean and the target, shown as **two separate facts**
  (mean, and target) — not yet as "X g below target", because the weight
  basis (gross vs net, and units) is one of the points still pending
  written confirmation from IFL (see §9).
- One station table, with each station's bias against the line average
  and against its own target.
- A control chart / drift view per station.

**Reading the numbers:** the on-screen target is the one **in force for
that station and that period** — a station that ran only one product in
the window is judged against that product's own target; a station that
ran more than one product in the window is shown with no single target
number, rather than a misleading blended one. Older readings that predate
per-product tracking fall back to the line-wide product, and the screen
marks this.

**What "—" means:** a blank target means the station ran more than one
product in the selected window (see above) — not that no target exists.

**Common questions:**
- *"Why did Weight's reject rate used to differ from Rejects and Report
  for the same dates?"* That divergence (three different formulas across
  three screens) was closed 23 Sep 2026; all three now agree to within
  measurement over a single source generation (a "generation" is one
  physical run of the plant's own recording tables — see §4).

### 2.4 Rejects

**Question it answers:** which cones failed, by what reason, when.

- Reject rate for the period, and a breakdown by reject code and by day.
- Trend graphs (requirement 4's contracted history/trend view).

**Reading the numbers:** reject-code *meanings* (what each numeric code
actually stands for on the floor) are still an open question with IFL
(Q10) — the app shows the codes as recorded; it does not yet translate
them to floor language.

**What "—" means:** as above, a missing figure is a fetch failure, named
as such, not a true zero.

### 2.5 Sacks

**Question it answers:** what sack production and stock look like at the
line level.

- Total sacks packed for the period, and a plain running register.
- A stock/ledger view — **line-level only**. The plant's own sack records
  carry no machine number and no record of a sack "leaving" — so **sack
  stock per machine cannot be shown**, by anyone, from the data IFL
  supplies. The screen says this plainly rather than guessing.
- A sack's card shows the cones weighed *between* the previous sack and
  this one, with a caveat printed: this is an approximate window, not a
  packing list — there is no key in the plant's data linking a specific
  cone to a specific sack.

**Common questions:**
- *"Why can't I see how many sacks Machine 4 has in stock right now?"*
  The plant's own data does not record which machine a sack came from —
  this is a known, permanent limitation of the source data, not something
  SMS failed to build. It would need either a PLC-side sack ID (out of
  scope, per IFL's own answer) or a manual entry step on the floor.

### 2.6 Product — four tabs

**Question it answers:** what is each machine running, what are its
limits, and how do I change it.

#### Running

The line-wide recorded product plus a by-product view of what's currently
running on each machine (the same window Line uses, grouped by product
instead of by machine). If nothing is recorded as running on any machine,
it says so plainly rather than showing an empty table with no explanation.

#### Changeover — step by step

This is how you put a different product onto a machine for a shift. It is
a **dry-run plan first, then (optionally) an execute step**:

1. Open **Product › Changeover**, choose the machine and the product you
   want it to run (an existing product, or a new blend/count/tube-type
   combination).
2. Click **Check the plan**. SMS builds a step-by-step plan of exactly
   what it would do — never runs anything yet.
3. Read the **Blockers** and **Warnings** sections:
   - **Blockers** stop the changeover outright; it cannot run until each
     one is resolved (for example, the new name you typed would collide
     with an existing blend/count/tube-type name once PDAS's own
     duplicate-name check is applied).
   - **Warnings** do not stop it, but are worth reading before you commit.
4. If you want to actually change the machine's product in PDAS, click
   **Execute the changeover**. As of today this is **switched off** on
   this computer with the message: *"Executing a changeover here is
   switched off until a full test of this feature has been run and passed
   on this computer."* The plan can still be checked and read at any time;
   only the final execute step is gated. **[UNVERIFIED on plant data]** —
   the write path has been proven against a local practice copy of PDAS
   only (24 Sep 2026); it has never run against the real plant database,
   and the gate stays closed until that has happened and IFL has been told.
5. There is **no automatic rollback**. Reversing a changeover means
   recording another changeover, not "undoing" the first one.

**What gets written to PDAS, precisely:** depending on the plan, a
changeover can create a new blend, count or tube type, create a new
product (a new blend+count+tube-type combination), retire or reactivate an
existing product, or change an existing product's weight limits — always
through the vendor's own PDAS procedures, the same ones IFL's engineers
already run by hand in SSMS. **Nothing is ever sent to a machine or a
PLC** — SMS writes only to the PDAS database; the scale itself only picks
up new limits the next time the product is selected on the machine.

**Why "retire, then create the same product again" is refused, and what
to do instead:** this feels like the natural way to "reset" a product, but
PDAS's own duplicate check for creating a product is based only on the
blend + count + tube-type triple — it does **not** look at whether the
old product is retired or active. So creating a new product with the same
three values as a retired one is refused with the same error as trying to
create a duplicate of a live one. This was confirmed by direct testing
against a practice copy of PDAS on 23 Sep 2026, and it matches an incident
IFL's own engineer hit four times on 18 Aug 2026 trying exactly this.
**The correct way to change a setpoint on an existing product is "Change
weight limits"** on that same product number — it keeps its number, so
past and future readings both stay linked to it. Only use "Create a new
product" when it is genuinely a different yarn (a different blend, count,
or tube type) than any product that already exists.

**Two distinct write actions, never one "Edit" button** — because they
mean different things:
- **Change weight limits** — keeps the product's number; changes only
  what the scale accepts. Requires a reason (at least 10 characters).
- **Create a new product** — gets a brand-new number; nothing already
  recorded is affected.

#### Catalogue

Every product recorded in PDAS, its limits, and forms to add, retire, or
re-limit one directly (the same actions Changeover offers, without the
machine-assignment step).

#### History

The trail of every product change ever recorded by SMS, including attempts
that were blocked before reaching PDAS (labelled as such, so an attempt
that never wrote anything is never confused with one that did).

### 2.7 Report

**Question it answers:** the printable/exportable summary — daily,
product, station, or management-summary figures for a chosen period.

- A management-summary KPI row and several report types (daily, by
  product, by station, by machine-and-product).
- **Generation warning:** if the period you picked spans a source rebuild
  (the plant dropped and rebuilt its own recording tables on 5 Aug 2026,
  restarting its own row numbering — SMS calls each side of that rebuild a
  "generation"), the report says so explicitly and states which readings
  it counted and which it excluded, rather than silently mixing two
  generations that are not one continuous record.
- **"Too much data" message:** if a report or query would return an
  unreasonably large result, SMS now refuses it server-side with *"Too
  much data for one view — choose a shorter period or filter"* instead of
  attempting to run it. Narrow the period or add a filter and try again.
- One report type — the machine-by-product matrix — can run to over 100
  columns (one per machine/day/shift). On screen it prints normally; **in
  print**, it deliberately suppresses itself with one line pointing at the
  CSV export instead, because no page size or type size can make 100+
  columns legible on paper.

**Exports:**
- **CSV** and **Excel** buttons are on the Report screen (rank: manager
  and above, since export can carry the full raw register). Attribution
  (line, period, who generated it, SMS version) is written into the file
  as trailing rows after a blank line — not as a comment header, because a
  comment header renders as a mangled first row in Excel.
- **There is no dedicated PDF export button.** To get a PDF, use your
  browser's own Print dialog and choose "Save as PDF" — SMS's print
  stylesheet (landscape for reports, portrait for the Readings register)
  is built for exactly this. **[No real print/PDF driver has verified this
  yet — see §8.]**

### 2.8 Health

**Question it answers:** can the numbers on every other screen be trusted
right now, and what has SMS itself flagged as a data-quality problem.

- Sync cadence and freshness, taken from the **oldest** of the plant's
  four source tables (not the newest) — one dead feed cannot hide behind
  three healthy ones.
- Open data-quality findings, grouped by which table they concern, each
  with a link to the actual record where possible; some finding types
  cannot be linked to a specific record and say why instead of guessing.
- A record of manually run verification checks (`sms verify`), plainly
  labelled as the record of a **manual** run, not a live, continuous check.

**What "could not read" means here specifically:** if a health fetch
itself fails, the block states in words that the count could not be read
— this is different from "0 findings open", which means SMS successfully
checked and found nothing.

### 2.9 Setup (admin only)

Machines, stations, users and system rules (weight limits, shift
boundaries, plausibility bounds). Below admin rank this tab does not
appear at all — it is the one screen genuinely hidden by role, because it
can change what every other screen measures against.

### 2.10 Wall

**Question it answers:** a fullscreen, no-navigation board for a shared
display (a TV or monitor on the floor), not a working screen for someone
signed in at a desk.

- One card per production line (currently one line, "TP1 Line 3 / Unit
  2"). Big type sized for viewing from a distance; stations shown as bars
  by count; a footer with the same freshness sentence as every other
  screen, pinned so it is always visible.
- Sessions viewing the Wall renew themselves automatically so a display
  left running does not get logged out.

[screenshot — to be captured on site: Wall board]

---

## 3. Shifts and shift dates

Shift boundaries, confirmed by IFL, are **06:00, 14:00 and 22:00**. A
night shift that starts at 22:00 and runs past midnight is counted under
its **start day** — i.e. a cone made at 01:00 on the 6th, during the
22:00-on-the-5th shift, belongs to the 5th, not the 6th. Any screen or
report grouping "by day" applies this rule consistently.

The plant's own stored "Shift" column on a raw reading is computed from
when the row was **inserted**, not from when the cone was actually made,
and is therefore wrong for a meaningful share of readings (the insert lag
described in §1 pushes some readings across a shift boundary). SMS
recomputes the shift from the reading's own production time rather than
trusting that stored column.

---

## 4. How rule and limit changes affect history

**A reading is always judged by the rules and limits that were in force at
its own time — never by today's rules applied backwards.** This is the
single rule most of SMS's design defends. Concretely:

- If you change a product's weight limits today, every reading recorded
  **before** that change keeps being judged against the **old** limits
  when you look at it later; only readings from **after** the change are
  judged against the new ones. SMS keeps a version history of every
  limit change for exactly this reason.
- The scale's own pass/fail bit (in/out of range) is one fact; the
  product's tolerance comparison is a second, separately labelled fact,
  and it is only shown at all when a product was genuinely recorded as
  running at that reading's own time. Older builds applied *today's*
  tolerance to weeks-old readings and printed a comparison that meant
  nothing; SMS no longer does this ("one status vocabulary" rule).
- Detectors that look for drift or a run of bad readings (station drift,
  the reject-episode list) deliberately ignore whatever period you have
  picked and always look at a fixed trailing 14 production days, because
  finding a genuine pattern needs several consecutive days, and a single
  shift is one point, not a pattern.

---

## 5. Machine states

Shown per machine on Line, Product › Running, and the Wall board:

| State shown | What it means |
|---|---|
| **Running** | Cones have been counted from this machine recently. |
| **No cones for `<span>` (last `<time>`)** | Nothing counted from this machine in the recent window, but it has reported before — likely a stop, a changeover in progress, or a scale issue. Not yet alarming on its own. |
| **Not seen since `<time>`** | Longer gap than "quiet" — worth checking. |
| **Not seen for over a week — check the machine or its scale** | A genuinely long silence. Check the machine's scale connection. |
| **Not currently running** | Shown on Product › Running for machines with no cone in the current window — a different label from "quiet", used specifically when grouping by product rather than by machine. |

None of these states are guesses when the freshness sentence at the top of
the screen (§1) is in its "link gone quiet" or "arriving too late" state —
in that case the screen withholds judging any machine's state rather than
risk a false "Stopped".

---

## 6. Reading "—" / "could not read" / stale / degraded, in one place

A short glossary, because these mean different things depending on where
you see them:

- **A dash (`—`) on a figure** — that particular value failed to load;
  the true value is unknown, not zero. The screen tries to say which part
  failed.
- **"Could not read" / "could not be confirmed"** — the same idea, spelled
  out in a sentence, usually on a print header or a Health block.
- **The freshness sentence (top of every screen) in its "stale" state** —
  the plant link itself has gone quiet; nothing on the page should be read
  as "the line is running" or "the line is stopped" until it recovers.
- **"Degraded" print header** — the print attribution block (line, period,
  who generated it) could not fully confirm itself, but still prints what
  it can confirm from what's on screen, plus a sentence naming what it
  could not state. It never substitutes your computer's clock for the
  plant's.
- **"Too much data for one view"** — not a fault; the request was too big
  and was refused before it could slow down or fail. Narrow the period.

---

## 7. Roles, precisely

Confirmed from the code as it stands today:

| Rank | Name | Server-enforced actions |
|---|---|---|
| 1 | Viewer | Read every screen |
| 2 | Engineer | + set running product, calibration adjustments, name/record reasons, change PDAS weight limits, run a changeover plan/execute |
| 3 | Manager | + export the raw register (CSV/Excel) |
| 4 | Admin | + Setup (machines, stations, users, system rules) |

Every gate above is enforced on the server, not just hidden in the menu —
a lower-ranked account cannot succeed by typing a URL directly.
**[UNVERIFIED on plant data]** — below-admin roles have been tested against
the rendering and the server gate in the local test suite, but no viewer,
engineer or manager account has yet signed in on a live instance; only an
admin session has been used so far.

---

## 8. Reports and exports — honest limits

- **CSV and Excel exports exist and are built.** Attribution is written as
  trailing rows, never a header comment (Excel would show a mangled first
  row).
- **There is no in-app PDF button.** PDF is produced by your browser's own
  Print-to-PDF, using SMS's print stylesheet (reports print landscape;
  the Readings register prints portrait — an explicit choice after both
  orientations were compared side by side).
- **No print pipeline has been verified against a real printer or PDF
  driver.** Every print claim in this system's own build notes comes from
  a simulated print layout in a test browser, cross-checked against the
  page's own measured width — a close approximation, not a proof that a
  real printer or a real "Print to PDF" dialog will render identically.
  **[UNVERIFIED on plant data]**
- **"Too much data"** — see §6.

---

## 9. What SMS deliberately does not do (and why)

So these are not mistaken for missing features:

- **No OEE (availability/performance/quality composite), no
  MTBF/MTTR, no shift-vs-shift stoppage-pattern screens.** IFL's own
  requirement list never asked for these; the underlying figures would be
  inferred from event timestamps rather than genuinely measured, and were
  judged unreadable in an earlier design. Time lost and stop count survive
  as plain figures on Report.
- **No AI-generated calibration recommendations.** The calibration
  advisory is built as real statistics (drift detection, a days-to-limit
  projection from measured drift) — not a machine-learning model — because
  that is what the data actually supports and can be defended if
  questioned.
- **No sack stock per machine.** The plant's own sack records carry no
  machine number; this cannot be computed by anyone from the data IFL
  supplies today (see §2.5).
- **No PLC connection.** Confirmed out of scope by IFL (Q22). SMS reads
  only from the plant's SQL Server database, never from a PLC directly,
  and nothing SMS does is ever written back to a machine or a PLC — only
  to PDAS, the vendor's own product database, and only through its own
  procedures.
- **Weight basis (gross vs net, and units) and full KPI approval are
  still pending written confirmation from IFL** — the Weight screen
  therefore states mean and target as two separate facts rather than
  "X g below target" until that is settled.

---

## 10. Who to call

- **A screen shows "could not read" or a dash where you expect a number:**
  check the freshness sentence at the top first — if it says the link has
  gone quiet, this is expected and should clear on its own once the plant
  connection recovers. If the freshness sentence looks healthy but a
  specific figure still won't load, report it with the screen name, the
  period you had selected, and a screenshot.
- **A changeover plan shows a blocker you don't understand:** read the
  blocker's own sentence first — it names the specific PDAS rule it hit
  (for example, a name collision). If it's still unclear, contact whoever
  administers SMS with the plan's blocker text and the product you were
  trying to create or change.
- **You need a new account, a role change, or a machine/station added or
  renamed:** this needs an admin account holder (Setup screen) — SMS's own
  developer/agent workflow is explicitly not allowed to create accounts on
  your behalf; ask your site admin.
- **Anything about PDAS write permissions, or "why is Execute switched
  off":** this is a deliberate safety gate, not a bug — see §2.6. Direct
  questions about enabling it to whoever owns the SMS project and IFL's
  written PDAS authority.

---

*This manual describes SMS as built and tested against a local practice
copy of IFL's own sample data, as of 24 Sep 2026. Sections marked
**[UNVERIFIED on plant data]** have not yet been confirmed against the
live plant database or a live print/PDF run, and should be re-checked
once SMS is running on site.*
