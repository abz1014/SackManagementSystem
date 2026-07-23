SET NOCOUNT ON;

PRINT '=== pack1_TP1U2 rows with epoch-0 ProductionDate ===';
SELECT COUNT(*) c FROM pack1_TP1U2 WHERE ProductionDate < '2000-01-01';
SELECT TOP 5 * FROM pack1_TP1U2 WHERE ProductionDate < '2000-01-01' ORDER BY id;

PRINT '=== pack1 raw: the 1644-row reference_value ===';
SELECT TOP 3 reference_value, COUNT(*) c FROM pack1 GROUP BY reference_value ORDER BY c DESC;

PRINT '=== pack1 raw: sample of top-colliding ref ===';
SELECT TOP 15 * FROM pack1 WHERE reference_value = (
  SELECT TOP 1 reference_value FROM pack1 GROUP BY reference_value ORDER BY COUNT(*) DESC
) ORDER BY id;

PRINT '=== pack1_TP1U2: exact duplicate ProductionDate counts ===';
SELECT dup_rows, COUNT(*) num_groups FROM (
  SELECT ProductionDate, COUNT(*) dup_rows FROM pack1_TP1U2 GROUP BY ProductionDate
) x GROUP BY dup_rows ORDER BY dup_rows DESC;

PRINT '=== pack1_TP1U2 zero/low weights ===';
SELECT COUNT(*) lt1500 FROM pack1_TP1U2 WHERE Weight < 1500;
SELECT TOP 10 * FROM pack1_TP1U2 WHERE Weight < 1500 ORDER BY Weight;

PRINT '=== sack1_TP1U2 zero weights ===';
SELECT * FROM sack1_TP1U2 WHERE Weight < 40;

PRINT '=== sack1_TP1U2 SackNum gaps / resets ===';
SELECT COUNT(*) total, MIN(SackNum) mn, MAX(SackNum) mx,
       MAX(SackNum)-MIN(SackNum)+1 AS span_if_contiguous
FROM sack1_TP1U2;
PRINT '--- points where SackNum decreases (counter reset) ---';
WITH s AS (SELECT id, Date, SackNum, LAG(SackNum) OVER (ORDER BY id) prev FROM sack1_TP1U2)
SELECT id, Date, prev AS prev_sacknum, SackNum AS new_sacknum FROM s WHERE SackNum < prev ORDER BY id;

PRINT '=== sack1_TP1U2 anomalous Source/Lifter mismatch in pack ===';
SELECT * FROM pack1_TP1U2 WHERE Source <> Lifter;

PRINT '=== rejectWeight1_TP1U2 sample ===';
SELECT TOP 10 * FROM rejectWeight1_TP1U2 ORDER BY id DESC;

PRINT '=== rejectQCS1_TP1U2 sample ===';
SELECT TOP 10 * FROM rejectQCS1_TP1U2 ORDER BY id DESC;

PRINT '=== does reject appear in pack1 too? overlap by HangerNum+time ===';
SELECT TOP 5 r.id, r.Date, r.HangerNum, r.Weight AS rej_w,
       (SELECT COUNT(*) FROM pack1_TP1U2 p
        WHERE p.HangerNum=r.HangerNum AND ABS(DATEDIFF(SECOND,p.Date,r.Date))<120) AS pack_matches
FROM rejectWeight1_TP1U2 r ORDER BY r.id DESC;

PRINT '=== hourly production rate sack ===';
SELECT TOP 10 DATEPART(HOUR,Date) hr, COUNT(*) c FROM sack1_TP1U2 GROUP BY DATEPART(HOUR,Date) ORDER BY hr;
