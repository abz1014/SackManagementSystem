SET NOCOUNT ON;

PRINT '=== decimal precision/scale ===';
SELECT t.name tbl, c.name col, ty.name typ, c.precision, c.scale
FROM sys.tables t JOIN sys.columns c ON t.object_id=c.object_id
JOIN sys.types ty ON c.user_type_id=ty.user_type_id
WHERE ty.name IN ('decimal','numeric','float') ORDER BY t.name,c.name;

PRINT '=== sack1_TP1U2 profile ===';
SELECT COUNT(*) rows_, MIN(Date) min_dt, MAX(Date) max_dt,
       MIN(Weight) min_w, MAX(Weight) max_w, AVG(Weight) avg_w,
       SUM(CASE WHEN inRange=0 THEN 1 ELSE 0 END) out_of_range,
       SUM(CASE WHEN Weight IS NULL THEN 1 ELSE 0 END) null_w,
       COUNT(DISTINCT SackNum) distinct_sacknum,
       MIN(SackNum) min_sn, MAX(SackNum) max_sn
FROM sack1_TP1U2;

PRINT '=== sack1_TP1U2 duplicate SackNum ===';
SELECT TOP 10 SackNum, COUNT(*) c FROM sack1_TP1U2 GROUP BY SackNum HAVING COUNT(*)>1 ORDER BY c DESC;

PRINT '=== sack1_TP1U2 by shift ===';
SELECT Shift, COUNT(*) c, AVG(Weight) avg_w, MIN(Weight) mn, MAX(Weight) mx FROM sack1_TP1U2 GROUP BY Shift;

PRINT '=== sack1_TP1U2 by day ===';
SELECT CAST(Date AS DATE) d, COUNT(*) c, SUM(CAST(Weight AS FLOAT)) total_kg,
       SUM(CASE WHEN inRange=0 THEN 1 ELSE 0 END) oor
FROM sack1_TP1U2 GROUP BY CAST(Date AS DATE) ORDER BY d;

PRINT '=== pack1_TP1U2 profile ===';
SELECT COUNT(*) rows_, MIN(Date) min_dt, MAX(Date) max_dt,
       MIN(ProductionDate) min_pd, MAX(ProductionDate) max_pd,
       MIN(Weight) min_w, MAX(Weight) max_w, AVG(Weight) avg_w,
       SUM(CASE WHEN inRange=0 THEN 1 ELSE 0 END) out_of_range,
       SUM(CASE WHEN ProductionDate IS NULL THEN 1 ELSE 0 END) null_pd,
       SUM(CASE WHEN HangerNum IS NULL THEN 1 ELSE 0 END) null_hanger,
       COUNT(DISTINCT Source) d_source, COUNT(DISTINCT Lifter) d_lifter,
       MIN(HangerNum) min_h, MAX(HangerNum) max_h
FROM pack1_TP1U2;

PRINT '=== pack1_TP1U2 Source/Lifter distribution ===';
SELECT Source, Lifter, COUNT(*) c FROM pack1_TP1U2 GROUP BY Source, Lifter ORDER BY c DESC;

PRINT '=== pack1_TP1U2 by shift ===';
SELECT Shift, COUNT(*) c, AVG(Weight) avg_w FROM pack1_TP1U2 GROUP BY Shift;

PRINT '=== pack1_TP1U2 Date vs ProductionDate lag (sec) ===';
SELECT MIN(DATEDIFF(SECOND,ProductionDate,Date)) min_lag,
       MAX(DATEDIFF(SECOND,ProductionDate,Date)) max_lag,
       AVG(DATEDIFF(SECOND,ProductionDate,Date)) avg_lag
FROM pack1_TP1U2 WHERE ProductionDate IS NOT NULL;

PRINT '=== rejectWeight1_TP1U2 profile ===';
SELECT COUNT(*) rows_, MIN(Date) mn, MAX(Date) mx, MIN(Weight) min_w, MAX(Weight) max_w, AVG(Weight) avg_w
FROM rejectWeight1_TP1U2;

PRINT '=== rejectQCS1_TP1U2 inspect result distribution ===';
SELECT TubeInspectResult, MaterialInspectResult, COUNT(*) c
FROM rejectQCS1_TP1U2 GROUP BY TubeInspectResult, MaterialInspectResult ORDER BY c DESC;

PRINT '=== rejectQCS1_TP1U2 profile ===';
SELECT COUNT(*) rows_, MIN(Date) mn, MAX(Date) mx FROM rejectQCS1_TP1U2;

PRINT '=== EAV raw: distinct item_id per table ===';
SELECT 'sack1' t, item_id, COUNT(*) c FROM sack1 GROUP BY item_id
UNION ALL SELECT 'pack1', item_id, COUNT(*) FROM pack1 GROUP BY item_id
UNION ALL SELECT 'rejectQCS1', item_id, COUNT(*) FROM rejectQCS1 GROUP BY item_id
UNION ALL SELECT 'rejectWeight1', item_id, COUNT(*) FROM rejectWeight1 GROUP BY item_id
ORDER BY t, item_id;

PRINT '=== EAV orphans: item_id not in t_items ===';
SELECT 'sack1' t, COUNT(*) c FROM sack1 WHERE item_id NOT IN (SELECT id FROM t_items)
UNION ALL SELECT 'pack1', COUNT(*) FROM pack1 WHERE item_id NOT IN (SELECT id FROM t_items)
UNION ALL SELECT 'rejectQCS1', COUNT(*) FROM rejectQCS1 WHERE item_id NOT IN (SELECT id FROM t_items)
UNION ALL SELECT 'rejectWeight1', COUNT(*) FROM rejectWeight1 WHERE item_id NOT IN (SELECT id FROM t_items);

PRINT '=== EAV incomplete groups sack1 (expect 3 rows per ref) ===';
SELECT cnt_per_ref, COUNT(*) num_refs FROM (
  SELECT reference_value, COUNT(*) cnt_per_ref FROM sack1 GROUP BY reference_value
) x GROUP BY cnt_per_ref ORDER BY cnt_per_ref;

PRINT '=== EAV incomplete groups pack1 (expect 7) ===';
SELECT cnt_per_ref, COUNT(*) num_refs FROM (
  SELECT reference_value, COUNT(*) cnt_per_ref FROM pack1 GROUP BY reference_value
) x GROUP BY cnt_per_ref ORDER BY cnt_per_ref;

PRINT '=== raw vs wide reconciliation ===';
SELECT 'sack1_raw_refs' k, COUNT(DISTINCT reference_value) v FROM sack1
UNION ALL SELECT 'sack1_wide_rows', COUNT(*) FROM sack1_TP1U2
UNION ALL SELECT 'pack1_raw_refs', COUNT(DISTINCT reference_value) FROM pack1
UNION ALL SELECT 'pack1_wide_rows', COUNT(*) FROM pack1_TP1U2
UNION ALL SELECT 'rejQCS_raw_refs', COUNT(DISTINCT reference_value) FROM rejectQCS1
UNION ALL SELECT 'rejQCS_wide_rows', COUNT(*) FROM rejectQCS1_TP1U2
UNION ALL SELECT 'rejW_raw_refs', COUNT(DISTINCT reference_value) FROM rejectWeight1
UNION ALL SELECT 'rejW_wide_rows', COUNT(*) FROM rejectWeight1_TP1U2;
