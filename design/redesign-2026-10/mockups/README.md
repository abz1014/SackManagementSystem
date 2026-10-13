# Approved redesign mockups (Oct 2026)

Style C was chosen. StyleA.dc.html and StyleB.dc.html are rejected alternatives, kept for the record. StyleC.dc.html is the chosen style sheet board.

## The 16 approved boards

Main, TodayEmpty, PeriodPanel, TodayPhone, Wall (dark Style C), States, QualityStations, QualityRejects, QualityWeight, Register, PdasBoard, PdasChangeover, PdasCatalogue, PdasLimitsHistory, Reports, Diagnostics.

Each is `<Name>.dc.html` in this folder. Shared files: `canvas.json`, `style-c.css`, `sms-extra.css`, `ds/ifl-sms/tokens.css`.

## Links

- Canvas: https://claude.ai/artifact/MHARnH4Gk3kKkYXtix2VAT
- Design system: https://claude.ai/artifact/2XsqivDMZmsjaCYpLvYBcd

## Notes

- Boards are Claude Design `.dc.html` files. They need `support.js` and are meant to be viewed on claude.ai, not opened locally.
- Any Google Fonts `@import` lines in the CSS are review-only and must never ship. The plant is air-gapped; fonts are self-hosted (Instrument Sans in `sms/web/public/fonts/`).
- `components/bundle.css` was not available locally and is not included.
