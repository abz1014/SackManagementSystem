# S-shots log (T7, 30 Sep 2026)
Viewport 1680x1000 dpr2 (1440 clipped the "Product" nav tab under the period buttons); full-page for page shots, element crop for block shots; S33 1920x1080 dpr1. Demo http://127.0.0.1:4100, default period unless noted. Redaction denylist scan passed on all (capture.mjs denylist parser fixed: only first backticked column of REDACTION.md table rows).

| ID | Result | Visible | Period/URL | Deviations |
|---|---|---|---|---|
| S01 | pass | login form | / | |
| S02 | pass | headline, KPIs, attention | ?s=line, This shift | shift chart says "only one shift, pick This week" |
| S03 | pass | nav, periods, Wall, DA, clock, lag+details | ?s=line | |
| S04 | pass | Attention block (one finding: 5 outside limits) | ?s=line, This week | station 7 not named in Attention; see S10/S11 |
| S05-S07 | pass (S05-S07 not eyeballed in detail) | registers | ?s=readings, rl=rejected/sacks | |
| S08 | pass | distribution bell chart, stations table | ?s=weight, This shift | limit/target lines absent: no product target recorded |
| S09 | pass | over-time | ?s=weight&wm=time, This week | not eyeballed |
| S10 | pass | stations table; st.7 rejects 23.4%, st.4 -2 g vs target | ?s=weight, This week | st.4 bias is small (-2 g), status "Steady", not flagged |
| S11 | pass | Pareto, trend, day/reason table | ?s=rejects, This week | reason names "not yet named" |
| S12-S20 | pass | per shot list | see shots.json | S13 shows DEMO-1024 "(retired in PDAS)" on st.14; not all eyeballed |
| S21-S23 | pass | Health: degraded ("backup: no backup found"), PDAS writes off | ?s=health | "IFL" and TP1U2 table names visible (company name, allowed) |
| S24-S32b | pass | Setup blocks | ?s=setup | numbering per shots.json; not eyeballed |
| S33 | pass | wall | ?s=wall | |
| S34 | pass | from/to date inputs | ?s=line, Pick dates | app wraps date inputs over the top of the nav bar; viewport-only shot |
