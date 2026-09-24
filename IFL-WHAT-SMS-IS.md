# Sack Management System (SMS) — what it is

One application for TP1 Line 3 / Unit 2: seven screens — Line, Readings,
Weight, Rejects, Sacks, Product, Report — each answering one question, with
one shared period control and one line stating how old the data is.

## What it does

- **Cone and sack weighing.** Every weighed cone and sack, flagged against
  the product's own limits at the time it was made, not today's limits.
- **Reject history**, by code, station and shift, with trend graphs.
- **Weight control charts and per-station drift**, with a statistical
  projection of days-to-action-limit — not AI. It is control-chart statistics:
  real, defensible, and it says so.
- **Product changeover per machine per shift** — your own stated key
  requirement: plan a product change, see every blocker PDAS would raise,
  before anything is written.
- **Ten report types**, daily and per shift, exported as a formatted Excel
  workbook (with real charts, not a bare grid) or a PDF — both generated on
  the server, both tested end to end against a running copy of this software.
- **Sack production per machine, by shift and by day** — not a per-machine
  stock ledger. Your own data has no machine or station column on the sack
  table, so a ledger is not computable from it by anyone; production is.

## Three things we measured on your own data, not assumed

- Your acquisition system writes a cone's row roughly **18 minutes** after
  the cone is weighed — 909 seconds minimum, 1,090 seconds mean, measured
  over 142,509 of your rows. The software judges "is the line running"
  against that lag, not the wall clock, so it does not report a stoppage
  that isn't real.
- Your four weighing tables were dropped and rebuilt on **5 August 2026**,
  restarting every row's id at 1. SMS keeps that as a separate data
  generation and never adds the two together.
- When a figure cannot be read, the screen states that plainly. It never
  shows a zero in place of "we don't know."

## How it connects to your systems

Read-only against your acquisition database — no schema change, no index,
no stored procedure, no data of yours touched. Your data is copied into
SMS's own database, on the PC we supply; every query the screens run reads
that copy, not your server.

## What we need from you

A dedicated read-only login, the server and instance name, and confirmation
the PC can reach it on your network. Full list: `IFL-OPEN-QUESTIONS.md`.

## What has and hasn't been tested

Every number above comes from the two database copies you sent us
(June–July and August–September 2026) on a development machine. Nothing in
this software has run against your live plant systems yet — every figure on
screen in a demo is your own data, and you can check it against your own
records.
