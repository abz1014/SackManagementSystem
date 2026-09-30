# Known limitations {appendix #appendix-limitations}

These are current, known limitations of SMS — not bugs waiting to be fixed
before go-live, but honest statements of what the system does and does not
do today.

1. **No PLC integration.** SMS reads from SQL Server only. A direct
   connection to the line's PLCs was scoped out by IFL's own decision; the
   `.env` keys for it exist only as a disabled, dependency-free re-entry
   point, read by no code path today.
1. **Sack stock per machine is not computable.** IFL's sack data carries no
   machine or station column — only the sack number, weight, in-range flag
   and insert time. The [[Sacks]] screen states this on screen rather than
   guessing.
1. **PDAS writes are off, and the plant writer login is not yet
   provisioned.** See {{ref:pdas-writes}}. The nine write actions have been
   proven against a non-production copy; none has ever run against the
   plant itself. Who at IFL may make limit changes, whether that needs a
   higher permission than the engineer role, and the size of change that
   counts as large (3 % or 20 g, the developer's numbers) are all still open.
1. **A changeover does not select the product on a machine.** It only makes
   a product selectable in PDAS. Whether a machine's own controller reads
   its limits from PDAS live is a separate, still-open question for IFL.
1. **The data is always some minutes old.** See {{ref:lag}} — roughly 18
   minutes, measured from IFL's own acquisition layer, not an SMS delay.
1. **Two separate clocks.** Production timestamps are the plant's own wall
   clock labelled UTC; everything SMS itself writes is genuine UTC — see
   {{ref:two-clocks}}. Never assume the two match without conversion.
1. **Planned breaks and faults cannot be told apart** in the source data. No
   downtime reason code exists; time-lost figures on the Report screen carry
   this caveat.
1. **A real gap exists in the historical data supplied so far** (26 days,
   10 July to 5 August), not yet filled by IFL. Nothing in SMS substitutes
   for the missing data; a data-quality check flags a production day that
   could plausibly sit inside this kind of gap. A tool to load it once it
   arrives exists (`epoch:backfill`) but has been proven only on scratch
   copies.
1. **One line is served per API process today.** Serving several lines from
   one installation is follow-on work, pending an IFL decision on whether
   more than one line is in scope.
1. **SQL Server Express caps a single database file at 10 GB.** [[Health]]
   reports the current size against this cap and raises a warning past 80%
   full. How long readings should be retained against this cap is IFL's own
   decision, not yet made.
1. **Only one calibration pattern rule is shown, deliberately.** The
   further seven Nelson rules were evaluated and rejected by measurement —
   they flagged an unworkably large share of stations on real data, because
   station weight readings are naturally autocorrelated from one reading to
   the next. [[Health]] and the Weight screen state this rather than
   silently omitting the rules.
1. **Weight basis and the shift-boundary rule are not fully confirmed by
   IFL.** The app states "not confirmed" wherever this matters; do not
   change `WEIGHT_BASIS` or `SHIFT_MODE` without a written answer from IFL.
1. **No email alerting**, because the plant PC is air-gapped.
   `GET /api/health` is meant to be polled by whatever monitoring tool the
   plant already runs.
1. **Retention of raw and canonical readings is undecided.** Nothing prunes
   readings automatically today; at the measured accumulation rate this is
   not urgent, but it remains IFL's decision to make.
1. **"Reports with graphics" is a requirement still being matched against
   what is built.** PDF, Excel and CSV export exist, with tables and charts
   rendered into the PDF — whether this fully satisfies IFL's own
   expectation is being tracked, not assumed closed.
1. **Not every elevated-rank route has an automated client/server rank
   cross-check.** The mechanical check covers only about 6 of roughly 25 to 32
   elevated-rank routes; the rest are verified by reading the code rather
   than by a mechanical test, a lower bar of proof, worth knowing if a future change touches access control.
1. **No off-machine backup of IFL's own source data exists yet**, beyond
   what this guide's own {{ref:backups}} section covers for the app
   database. Both of IFL's data samples, and every copy of the SMS
   deliverable itself, currently live on a single machine — an operational
   risk for IFL to accept or remedy, not a defect in SMS's own code.
1. **Backups are proven, not yet unattended.** The backup script checks each
   file and writes a marker Health reads. It has been run by hand once. The
   nightly schedule has not run unattended, and no copy leaves this one PC.
1. **SMS shifts can differ from IFL's vendor screen.** SMS works shifts out
   from production time; the vendor's Shift column uses insert time. Reports
   carry a footnote. Which is right for IFL is an open question.
1. **A wrong time zone only warns.** If the PC's time zone does not match
   `PLANT_UTC_OFFSET_MINUTES`, SMS logs a warning but still starts.
1. **Rules are read as "current", not "in force".** Weight and plausibility
   rules apply as they are now; shift-rule history is honoured for range
   edges since 29 September 2026, but rows transformed earlier keep their old
   shift.
1. **A recorded weight of exactly 0 is unexplained.** Two real IFL rows are
   zero. What a zero means is a question for IFL. They keep Health at
   "degraded" until an engineer acknowledges them.
1. **A sign-in failure can hide a database problem.** The generic sign-in
   error is shown for a wrong password and for some database-connection
   failures.
1. **Go-live conditions are still open.** The software is ready for a
   supervised pilot, not unattended production: read-only logins for both
   databases, services and backups proven on the target PC, an off-machine
   copy, a two-week parallel run, and written answers from IFL are all
   outstanding.
1. **The print/PDF layout has a real automated test harness, but no case
   needing a signed-in session has been run through it yet** for want of
   a dedicated test account and credentials.
1. **No one has yet signed in as a viewer-rank account on a live
   instance.** Rank-1 rendering is proven by an automated test against a
   simulated sign-in, not by an actual person's session — worth confirming
   once IFL has created a viewer account.
