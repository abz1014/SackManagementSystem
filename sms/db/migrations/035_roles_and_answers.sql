-- 035_roles_and_answers.sql — IFL's answers of 15 Sep 2026 (via Hassan sb),
-- applied to the three rows of app-owned data they change. Wave F, agent F3.
--
-- Three statements, each idempotent, each a data change and never a schema
-- change; every one of them can be re-run on a database that already
-- carries it and does nothing the second time.
--
-- (a) ROLE NAMES. sms.role was seeded (011) as operator / supervisor /
--     manager / admin. IFL's people are the GM, managers and process
--     engineers (Q38, 2 Sep 2026), and the answers of 15 Sep put the
--     process engineer on the floor in charge of products, limits and sack
--     adjustments (Q19/Q40/Q41/Q43): the rank-2 account is an ENGINEER, not
--     a supervisor, and the rank-1 account only looks. The rename was owed
--     since REDESIGN.md §"Roles" (3 Sep 2026). Names change; ranks 1..4,
--     role_id and every app_user.role_id do not, so nobody's access moves
--     and no session is affected. Updated BY RANK, guarded by the old name,
--     so a database already renamed is untouched.
--
-- (b) SACK WEIGHT BASIS. Q24 (15 Sep 2026): the recorded sack weight is the
--     total (gross) weight of the sack. sms.weight_rule is append-only (the
--     newest effective_from is the rule), so this is a NEW row for line 1
--     with basis 'gross' and the same tube and tare as the newest row — or
--     the seed defaults (70 g, 0.5 kg; shared/src/config/appConfig.ts) on a
--     database that has no rule row yet, which is the state of a plant
--     sidecar migrated before its first sync pass. Inserted only when the
--     newest row's basis is not already 'gross'. Arithmetically 'gross' and
--     'as_recorded' are the same thing (no tare is subtracted; only 'net'
--     subtracts), so no figure changes: what changes is that the rule now
--     STATES the basis IFL gave instead of declining to. The cone side of
--     the same rule is not what Q24 answered — the cone weight basis stays
--     unconfirmed on the Weight screen (words.ts, weight.headlineUnconfirmed).
--
-- (c) MACHINE = STATION. Q1/Q3 (15 Sep 2026): a machine IS a station, 1–14.
--     Migration 028 linked station N to winder N by number and marked the
--     link 'default_by_number' — a default the UI printed as unconfirmed.
--     Those rows become 'confirmed_by_ifl'. Links an admin set by hand
--     ('admin') and unlinked stations (NULL) are left alone: IFL confirmed
--     the default, not somebody's later edit. The seed (seedReference.ts)
--     still writes 'default_by_number' for a machine added after this date,
--     because IFL's answer described the fourteen that exist.
--
-- No PDAS or DATA_TP1U2 object is touched; this file runs on the sidecar only.

-- (a) role names, by rank, guarded by the old name --------------------------
UPDATE sms.role SET name = 'viewer'   WHERE rank = 1 AND name = 'operator';
UPDATE sms.role SET name = 'engineer' WHERE rank = 2 AND name = 'supervisor';
GO

-- (b) the sack weight basis IFL gave: gross ----------------------------------
IF NOT EXISTS (
    SELECT 1
      FROM sms.weight_rule w
     WHERE w.line_id = 1
       AND w.effective_from = (SELECT MAX(effective_from) FROM sms.weight_rule WHERE line_id = 1)
       AND w.basis = 'gross'
)
BEGIN
    INSERT INTO sms.weight_rule (line_id, basis, cone_tube_weight_g, sack_tare_kg, effective_from, changed_by, reason)
    SELECT 1,
           'gross',
           COALESCE((SELECT TOP 1 cone_tube_weight_g FROM sms.weight_rule WHERE line_id = 1 ORDER BY effective_from DESC), 70),
           COALESCE((SELECT TOP 1 sack_tare_kg       FROM sms.weight_rule WHERE line_id = 1 ORDER BY effective_from DESC), 0.5),
           SYSUTCDATETIME(),
           NULL,   -- no signed-in actor: a migration wrote it, and the reason says on whose word
           N'IFL answer Q24, 15 Sep 2026: the recorded sack weight is the total weight of the sack';
END
GO

-- (c) the station ↔ machine link IFL confirmed --------------------------------
UPDATE sms.station
   SET link_source = 'confirmed_by_ifl'
 WHERE link_source = 'default_by_number';
GO
