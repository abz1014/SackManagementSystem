# Owner approval - SMS redesign, 13 Oct 2026

The owner approved this redesign on 13 Oct 2026 in chat: "approved, go with your recommendations and start building".

## Decisions

- Scope: a full redesign of the web interface.
- Visual style: Style C, "Soft premium", for desk and phone. A dark variant of Style C is used for the TV wall.
- Font: Instrument Sans is replaced by Manrope. It is a self-hosted OFL woff2 file, not an npm dependency.
- Information architecture: Today / Quality (Weight, Rejects, Stations, Register) / Products & PDAS (Board, Changeover, Catalogue, Limits & History) / Reports (5 cards) / System (Diagnostics, Setup, Account).
- Phone: a bottom bar with Today, Quality, Products, Reports, More.
- Station state rule (an assumed default, computed server-side): Act if a station's failed-inspection rate is more than 2x the line rate; Watch if more than 1.5x; No data if the station has no cones.
- The Attention list is unchanged (the attention.ts rule is kept). The heat grid carries silent and high-reject stations.
- Four report merges, UI only: shift into daily, sack into sack-weight-summary, product into machine-product, station into cone-weight. API routes and exports are unchanged.
- The sack stock ledger sits under Quality > Register.
- No new libraries: custom charts and about 20 hand-drawn SVG icons.
- Owner-reserved wording is kept verbatim for now. Only the layout around it changes, for example "Station 5 · East Conveyor".
- Rollout: build alongside the old UI as sms/web-next, served at /next, and switch when parity passes.
- Scope is frontend plus small API additions. No database schema changes.
- Restyling the PDF and Excel exports is a later phase.

## Mockups (private)

- Claude Design canvas "IFL SMS Screens": https://claude.ai/artifact/MHARnH4Gk3kKkYXtix2VAT
- Design system: https://claude.ai/artifact/2XsqivDMZmsjaCYpLvYBcd

## Notes

The package in this folder (DESIGN-SYSTEM.md, GLOSSARY.md, IA-MAP.md, tokens.css, mockup-data.*) is the design contract. Where DESIGN-SYSTEM.md still says the Wall is light or that there is no dark mode in v1, this approval supersedes it: the wall uses a dark variant of Style C.
