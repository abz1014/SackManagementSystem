-- 041_tube_type_form.sql — mirror PDAS TubeTypes.TubeForm onto sms.tube_type.
--
-- THE DEFECT THIS CLOSES. `AddTubeType`'s own duplicate check (verified
-- against the proc body on PDAS_TP1U2_SEP07, likePattern.ts's header) is
-- `TubeType LIKE @tubeType AND TubeForm = @tubeForm` — a COMPOUND key, name
-- pattern AND exact form together. `sms.tube_type` (this table, since
-- migration 006) carried no tube_form column at all, so
-- `api/src/services/changeover.ts`'s `resolveTube` (commit a9b85b5, B4) could
-- only ever compare on name:
--   (a) an EXACT name match was reused even when the requested form
--       differed from the existing row's — silently attaching a changeover
--       to the wrong tube type (the serious half of this defect: PDAS would
--       have accepted the request as a genuinely new, different tube type,
--       since AddTubeType's own check would not have refused it — the plan
--       instead planned to reuse an unrelated one);
--   (b) a LIKE-pattern collision against a row in a DIFFERENT form was
--       over-blocked, refusing a request PDAS's own check would have let
--       AddTubeType's INSERT proceed.
--
-- This column is the fix's prerequisite: nullable, because the mirror only
-- learns a row's form the next time seedProducts's full read runs (or the
-- post-AddTubeType echo-back MERGE writes it directly) — existing rows read
-- NULL until then, and resolveTube (this migration's companion code change)
-- treats NULL as "unknown, never silently reuse", never as "form 0" or any
-- other guess.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('sms.tube_type') AND name = 'tube_form'
)
BEGIN
    ALTER TABLE sms.tube_type ADD tube_form INT NULL;
END
GO
