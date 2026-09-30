# How SMS works {#how-sms-works}

## The big picture {#big-picture}

SMS is built from three long-running pieces, plus the app's own database.
The plant's Siemens S7-1500 PLCs weigh every cone and every sack; a
tag-acquisition layer IFL already runs writes those readings into two SQL
Server databases (`DATA_TP1U2` for weights and rejects, `PDAS_TP1U2` for
product/material master data). SMS never touches those databases except to
read from them.

![SMS architecture: the sync worker reads IFL's SQL Server (read-only) on a short cycle and writes to SMS's own app database; the API reads that database and serves the desk PCs and the wall display over the plant network. Product writes to PDAS are shown as off until enabled. The command-line tool is not drawn.](../images/F-architecture.png)

- **The sync worker** is the only SMS process that connects to IFL's SQL
  Server, and it only ever reads. It runs on a schedule (every
  `SYNC_INTERVAL_SECONDS`, 60 seconds by default), pulls new rows, and writes
  them into SMS's own app database after resolving which source generation
  they belong to (see {{ref:generations}}).
- **The API** serves `/api/*` to the browser, and also serves the built web
  app itself when `WEB_DIST` is set — the normal production setup is one
  process doing both.
- **The CLI** (`node cli/dist/index.js <command>`) runs one-off operations:
  the first sync, verifying data against the source, listing and accepting
  source generations, creating accounts, and maintenance tasks. See
  Appendix B for the full command reference.
- **The app database** is SMS's own SQL Server Express database. It holds
  the canonical readings the sync worker has processed, plus everything SMS
  itself writes: accounts, sessions, the audit log, calibration adjustments,
  and the product timeline.

## The ~18-minute lag {#lag}

IFL's own acquisition layer writes a cone's row to the database about 18
minutes after the cone is actually weighed (measured: 909 seconds minimum,
1090 seconds mean, over more than 142,000 readings). This means the newest
reading available to SMS is always some minutes behind the present moment —
even on a perfectly healthy, running line.

SMS accounts for this rather than hiding it. Every screen that talks about
"now" measures the lag from IFL's own data (the gap between when a reading
was produced and when it was written) and judges whether the line is running
against `now − that lag`, not the wall clock. The strip under the top bar
states the lag in words, with a [[details]] link through to [[Health]]. Do
not read "no readings in the last few minutes" as "the line is stopped" —
check the stated lag first.

## Plant clock and computer clock {#two-clocks}

SMS deliberately keeps two clocks separate, and never mixes them:

- **The plant's production clock.** Every cone, sack and reject reading
  carries a production timestamp written by the plant's own systems. This
  timestamp is stored labelled as UTC but is really the plant's own local
  wall clock.
- **The app's own clock.** Anything SMS itself writes — the product
  timeline, calibration adjustments, sync-run records, account actions — is
  stamped in genuine UTC, from the server the API and sync worker run on.

On this plant the two are about five hours apart (`PLANT_UTC_OFFSET_MINUTES`,
UTC+5). A screen that shows both a production time and an app-written time
never mixes them without saying so; when comparing the two matters, the
screen states which clock it means.

## Source generations, in plain words {#generations}

IFL's own source tables can be rebuilt: dropped and recreated with every
identity counter restarted from 1. This has already happened once, on
2026-08-05. SMS calls each such rebuilt period of a table a **generation**
(or epoch). Two generations of the same table are not one continuous record
— an `id` of 500 in one generation is a different row from `id` 500 in
another — so SMS never silently merges them.

When the sync worker meets a generation it has not seen before, it halts and
waits for an operator to run `epoch:accept` (see {{ref:install-first-connection}}
and Appendix B) rather than guessing. Reports and charts that would otherwise
mix two generations state plainly that they cover one generation only, and
how many readings from another generation were left out.

## Glossary {#glossary}

| Term | Meaning |
|---|---|
| Cone | A single wound package of yarn, weighed individually as it comes off a machine. |
| Sack | A finished sack of packed cones, weighed as a unit on the packing scale. |
| Station / machine | A physical spinning machine on the line; SMS uses "station" and "machine" for the same thing depending on the screen. |
| Reject | A cone the scale or an inspector marked as not acceptable — for a weight reason or a quality reason. |
| Product / material | The blend, count and tube combination a machine is currently running, recorded in PDAS. |
| PDAS | IFL's existing product-master database (`PDAS_TP1U2`) — blends, counts, tube types, materials and pallets. SMS reads it, and can optionally write to it (see {{ref:pdas-writes}}). |
| Generation | A distinct rebuild of one of IFL's source tables; see {{ref:generations}}. |
| Sync pass | One run of the sync worker's read-transform-write cycle. |
| DQ finding | A data-quality finding SMS raises about its own readings or its own connection health — shown on [[Health]] and Setup. |
| Shift day | The production day used for reporting, running 06:00 to 06:00 on the plant clock (see {{ref:big-picture}} for how that clock is defined). |
