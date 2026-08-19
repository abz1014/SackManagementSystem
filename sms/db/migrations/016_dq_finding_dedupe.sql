-- 016_dq_finding_dedupe.sql — one-time cleanup for the Aug 2026 audit finding:
-- the transform used to recompute DQ over the ENTIRE dataset every sync pass
-- and re-INSERT identical findings each time (+8 rows/pass, unbounded — the
-- same two standing faults were recorded 13 times over). The transform is now
-- batch-scoped (findings recorded once, at ingest), so the duplicates stop;
-- this removes the ones already written, keeping the EARLIEST report of each
-- distinct (check, table, detail) — the one from the pass that actually
-- ingested the offending rows.
--
-- Safe to re-run (idempotent): the second run finds no duplicates.
DELETE f
FROM sms.dq_finding f
JOIN (
    SELECT MIN(finding_id) AS keep_id, check_name, subject_table, detail
    FROM sms.dq_finding
    GROUP BY check_name, subject_table, detail
    HAVING COUNT(*) > 1
) d
  ON  f.check_name = d.check_name
  AND f.subject_table = d.subject_table
  AND (f.detail = d.detail OR (f.detail IS NULL AND d.detail IS NULL))
  AND f.finding_id <> d.keep_id;
GO
