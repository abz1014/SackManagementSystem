# DEMO-STATE (T5, 30 Sep 2026)

Demo API: http://127.0.0.1:4100 (SMS_DEMO / DATA_DEMO_SIM / PDAS_DEMO). Worker + `sim --live` + API running in background. 21-day backfill 2026-09-09..09-29 (plus live 09-30). Frozen at commit in FREEZE.md.

## Visible problems (window 2026-09-16 .. 2026-09-29, Weight screen /api/weight-stations)
- **Station 4 weight bias**: mean 1948.54 g, -2.79 g vs line mean 1951.33 g, -1.46 g vs its material target (1950). Every other station within about +/-1.5 g (station 13: -0.92, station 10: +1.48). NOTE: station 4 is NOT `flagged` on the Weight table (flagged=false for all 14; the drift detector's flag needs consecutive held days) - the evidence is the vs-line column, not a flag.
- **Station 7 reject spike (from 25-shape script)**: reject rate 22.65% vs about 1.4-3.5% elsewhere (line 3.87%). Last 2 production days (from 2026-09-28) carry the spike; 304 station-7 cones moved to rejectQCS.
- Attention list: one finding, `outside_product_limits` count 5 (readings screen).

## Products
- Machine 14 (Winder 14): DEMO-1024, productActive=false -> "(retired in PDAS)". Machine 13 = DEMO-1023 active. Machines 1-5 DEMO-21, 6-9 DEMO-20; all 14 "running" at last check.
- Line-wide targetG is null (no line product set); per-station targets come from each station's material (targetBasis station_material).

## Changeover
- `GET /api/product-write/status`: enabled=false, reason "PDAS_WRITE_ENABLED is not true.", canWrite=false. Changeover refs list: 3 blends, 2 counts, 2 tube types, 2 pack schemas, pallets 23-25 (DEMO-1021..1023). No plan/execute was run.

## Sample ids (SMS_DEMO canonical, shift_date 2026-09-25)
- Cone: cone_event_id 119338 (station 4, 1936.47 g, 2026-09-25 06:00:01)
- Sack: sack_event_id 5447 (47.223 kg, 2026-09-25 06:04:03)
- Reject: reject_event_id 2496 (quality, station 7, tube code 1, material code 1)
- Stock day: 2026-09-25 (336 sacks)

## Rejects
- Top reason (2026-09-16..09-29): "Tube 10 . Mat 1", 1583 of 2651 (59.7%); then Tube 2 . Mat 1 21.7%, Weight out of range 7.4%.

## Health
- `/api/health`: status **degraded**, only reason "backup: no backup found" (BACKUP_DIR C:\sms-demo-backups exists, empty; no backup taken - backup-appdb.ps1 needs an `sms_backup` login which was not authorised). Acquisition ok, cadence 60 s, generation DATA_DEMO_SIM#1 (simulator). `sms verify` clean: 4 epochs reconcile, raw<->canonical clean; DQ findings CRITICAL 0 / ERROR 0 / WARNING 3 / INFO 6.

## Baselines (SMS_DEMO)
- sms.audit_log = 5 (includes the demo-admin sign-ins/user create done during bring-up); sms.product_change = 0.
- Row counts after first sync: cone_raw 158867, sack 7273, reject_qcs 3622, reject_weight 302 (canonical reject_event 3924).
