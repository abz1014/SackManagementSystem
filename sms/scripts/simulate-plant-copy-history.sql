USE [DATA_TP1U2_SIM];
GO
-- Copy IFL's real 19 days into the simulator so it is a COMPLETE stand-in for
-- their database rather than a partial one. Without this the reconciliation
-- check compares a source holding only new rows against a raw layer holding
-- everything, and reports a mismatch that is an artefact of the rehearsal.
-- Read-only against DATA_TP1U2; ids do not overlap the generated rows.
INSERT INTO dbo.pack1_TP1U2 (id,[Date],[Shift],[Area],[ProductionDate],[HangerNum],[Source],[Lifter],[Weight],[inRange])
SELECT s.id,s.[Date],s.[Shift],s.[Area],s.[ProductionDate],s.[HangerNum],s.[Source],s.[Lifter],s.[Weight],s.[inRange]
FROM [DATA_TP1U2].dbo.pack1_TP1U2 s
WHERE NOT EXISTS (SELECT 1 FROM dbo.pack1_TP1U2 d WHERE d.id = s.id);

INSERT INTO dbo.sack1_TP1U2 (id,[Date],[Shift],[Area],[SackNum],[Weight],[inRange])
SELECT s.id,s.[Date],s.[Shift],s.[Area],s.[SackNum],s.[Weight],s.[inRange]
FROM [DATA_TP1U2].dbo.sack1_TP1U2 s
WHERE NOT EXISTS (SELECT 1 FROM dbo.sack1_TP1U2 d WHERE d.id = s.id);

INSERT INTO dbo.rejectQCS1_TP1U2 (id,[Date],[Shift],[Area],[ProductionDate],[HangerNum],[Source],[Lifter],[TubeInspectResult],[MaterialInspectResult])
SELECT s.id,s.[Date],s.[Shift],s.[Area],s.[ProductionDate],s.[HangerNum],s.[Source],s.[Lifter],s.[TubeInspectResult],s.[MaterialInspectResult]
FROM [DATA_TP1U2].dbo.rejectQCS1_TP1U2 s
WHERE NOT EXISTS (SELECT 1 FROM dbo.rejectQCS1_TP1U2 d WHERE d.id = s.id);

INSERT INTO dbo.rejectWeight1_TP1U2 (id,[Date],[Shift],[Area],[ProductionDate],[HangerNum],[Source],[Lifter],[Weight])
SELECT s.id,s.[Date],s.[Shift],s.[Area],s.[ProductionDate],s.[HangerNum],s.[Source],s.[Lifter],s.[Weight]
FROM [DATA_TP1U2].dbo.rejectWeight1_TP1U2 s
WHERE NOT EXISTS (SELECT 1 FROM dbo.rejectWeight1_TP1U2 d WHERE d.id = s.id);
GO
SELECT 'pack1' t, COUNT(*) n, MIN(ProductionDate) first_prod, MAX(ProductionDate) last_prod FROM dbo.pack1_TP1U2
UNION ALL SELECT 'sack1', COUNT(*), MIN([Date]), MAX([Date]) FROM dbo.sack1_TP1U2
UNION ALL SELECT 'qcs', COUNT(*), MIN(ProductionDate), MAX(ProductionDate) FROM dbo.rejectQCS1_TP1U2
UNION ALL SELECT 'wrej', COUNT(*), MIN(ProductionDate), MAX(ProductionDate) FROM dbo.rejectWeight1_TP1U2;
