-- seed-dev-epochs.sql — the DEVELOPMENT machine's two closed source generations.
--
-- This block used to live inside migration 025. It was moved out on
-- 14 Sep 2026 because it describes ONE developer laptop's history — server
-- 'localhost', databases DATA_TP1U2 / DATA_TP1U2_SIM, and the byte-exact
-- create_date keys of the sample copies attached there. Its IF NOT EXISTS
-- guard is satisfied on EVERY fresh database, so left in the migration it
-- would have seeded a plant installation with eight tombstones describing a
-- laptop. A production sidecar must start with an EMPTY sms.source_epoch and
-- register its live generation with `sms epoch:accept`.
--
-- Run this ONLY on the development sidecar, ONLY after migration 025, and
-- ONLY once:   sqlcmd -S localhost,14330 -E -d sms -i scripts/seed-dev-epochs.sql
-- (The development database already holds these rows; re-running is a no-op.)

-- Seed the two generations this database already holds. Order is fixed so the
-- epoch_ids are deterministic: 1-4 = IFL's July copy, 5-8 = the plant simulator.
--
-- source_created_key values are the REAL create_dates, read from DATA_TP1U2 and
-- (for the simulator) from the epoch.* keys this app recorded live before the
-- simulator tables were rebuilt. They carry milliseconds because the adapter's
-- toISOString() does; a truncated value would never match and would silently
-- register a duplicate generation.
--
-- Fingerprints are read from app_config rather than hardcoded — it is the only
-- surviving record of what those generations' columns were, and copying it by
-- hand is how a transcription error becomes a permanent false baseline.
-- BOTH bootstrap generations are seeded CLOSED. Neither is the source this
-- worker will read next: the July sample's generation was destroyed by IFL on
-- 2026-08-05, and the simulator's rows are being purged. The live generation
-- (September) is registered later, deliberately, by `sms epoch:accept`.
--
-- UX_source_epoch_open enforces this — it permits at most one OPEN epoch per
-- (line, table), so seeding two open rows for pack1_TP1U2 is rejected outright.
-- That rejection is the constraint doing exactly what it exists for.
--
-- closed_utc is the real end of each generation, not the time this migration
-- ran: the July rows close at IFL's own recreate timestamps (read from
-- DATA_TP1U2_SEP07's sys.tables.create_date), the simulator rows at the purge.
IF NOT EXISTS (SELECT 1 FROM sms.source_epoch)
BEGIN
    INSERT INTO sms.source_epoch
      (line_id, source_table, source_server, source_db, source_created_key,
       schema_fingerprint, provenance, generation_ordinal, label, registered_by,
       closed_utc, note)
    SELECT v.line_id, v.source_table, v.source_server, v.source_db, v.source_created_key,
           ISNULL((SELECT TOP 1 c.config_value FROM sms.app_config c
                    WHERE c.config_key = 'fingerprint.' + v.source_table),
                  '00000000000000000000000000000000'),
           v.provenance, v.generation_ordinal, v.label, 'bootstrap',
           v.closed_utc, v.note
    FROM (VALUES
      (1,'pack1_TP1U2',        'localhost','DATA_TP1U2',    '2026-06-19T11:53:05.787Z','ifl_copy',  1,N'July copy — cones',
         CONVERT(datetime2(3),'2026-08-05T19:03:16'),
         N'IFL sample 22 Jun - 10 Jul 2026. IFL dropped and recreated this table on 2026-08-05 19:03:16, ending the generation; our sample is the only copy we hold. 10 Jul - 5 Aug was never sent and is still to be requested.'),
      (1,'sack1_TP1U2',        'localhost','DATA_TP1U2',    '2026-06-18T18:47:43.500Z','ifl_copy',  1,N'July copy — sacks',
         CONVERT(datetime2(3),'2026-08-05T18:54:50'), NULL),
      (1,'rejectQCS1_TP1U2',   'localhost','DATA_TP1U2',    '2026-06-19T11:58:38.250Z','ifl_copy',  1,N'July copy — quality rejects',
         CONVERT(datetime2(3),'2026-08-05T18:58:13'), NULL),
      (1,'rejectWeight1_TP1U2','localhost','DATA_TP1U2',    '2026-06-22T11:20:25.023Z','ifl_copy',  1,N'July copy — weight rejects',
         CONVERT(datetime2(3),'2026-08-05T18:59:18'), NULL),
      (1,'pack1_TP1U2',        'localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.900Z','simulator', 2,N'Simulator — cones',
         CONVERT(datetime2(3),'2026-09-11T00:00:00'),
         N'scripts/simulate-plant.mjs. SYNTHETIC — never happened on a plant. Rows purged 2026-09-11; this row is kept as a tombstone so the id range is never silently reused. Its window (26 Aug - 3 Sep) overlapped the real September copy by nine days.'),
      (1,'sack1_TP1U2',        'localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.900Z','simulator', 2,N'Simulator — sacks',
         CONVERT(datetime2(3),'2026-09-11T00:00:00'), N'SYNTHETIC. Rows purged 2026-09-11.'),
      (1,'rejectQCS1_TP1U2',   'localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.900Z','simulator', 2,N'Simulator — quality rejects',
         CONVERT(datetime2(3),'2026-09-11T00:00:00'), N'SYNTHETIC. Rows purged 2026-09-11.'),
      (1,'rejectWeight1_TP1U2','localhost','DATA_TP1U2_SIM','2026-09-02T14:42:03.903Z','simulator', 2,N'Simulator — weight rejects',
         CONVERT(datetime2(3),'2026-09-11T00:00:00'), N'SYNTHETIC. Rows purged 2026-09-11.')
    ) AS v(line_id, source_table, source_server, source_db, source_created_key,
           provenance, generation_ordinal, label, closed_utc, note);
END
GO
