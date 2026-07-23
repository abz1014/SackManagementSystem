SET NOCOUNT ON;

PRINT '########## PRIMARY KEYS ##########';
SELECT t.name AS tbl, i.name AS pk_name, c.name AS col, ic.key_ordinal
FROM sys.tables t
JOIN sys.indexes i ON t.object_id=i.object_id AND i.is_primary_key=1
JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id
JOIN sys.columns c ON ic.object_id=c.object_id AND ic.column_id=c.column_id
ORDER BY t.name, ic.key_ordinal;

PRINT '########## FOREIGN KEYS ##########';
SELECT fk.name AS fk_name, tp.name AS parent_tbl, cp.name AS parent_col,
       tr.name AS ref_tbl, cr.name AS ref_col
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fk.object_id=fkc.constraint_object_id
JOIN sys.tables tp ON fkc.parent_object_id=tp.object_id
JOIN sys.columns cp ON fkc.parent_object_id=cp.object_id AND fkc.parent_column_id=cp.column_id
JOIN sys.tables tr ON fkc.referenced_object_id=tr.object_id
JOIN sys.columns cr ON fkc.referenced_object_id=cr.object_id AND fkc.referenced_column_id=cr.column_id
ORDER BY tp.name, fk.name;

PRINT '########## INDEXES (non-PK) ##########';
SELECT t.name AS tbl, i.name AS idx, i.type_desc, i.is_unique,
       STUFF((SELECT ', ' + c2.name
              FROM sys.index_columns ic2
              JOIN sys.columns c2 ON ic2.object_id=c2.object_id AND ic2.column_id=c2.column_id
              WHERE ic2.object_id=i.object_id AND ic2.index_id=i.index_id
              ORDER BY ic2.key_ordinal FOR XML PATH('')),1,2,'') AS cols
FROM sys.tables t
JOIN sys.indexes i ON t.object_id=i.object_id
WHERE i.is_primary_key=0 AND i.type>0
ORDER BY t.name, i.name;

PRINT '########## DEFAULT CONSTRAINTS ##########';
SELECT t.name AS tbl, c.name AS col, dc.definition
FROM sys.default_constraints dc
JOIN sys.tables t ON dc.parent_object_id=t.object_id
JOIN sys.columns c ON dc.parent_object_id=c.object_id AND dc.parent_column_id=c.column_id
ORDER BY t.name, c.name;

PRINT '########## CHECK CONSTRAINTS ##########';
SELECT t.name AS tbl, cc.name, cc.definition
FROM sys.check_constraints cc
JOIN sys.tables t ON cc.parent_object_id=t.object_id
ORDER BY t.name;

PRINT '########## VIEWS ##########';
SELECT name FROM sys.views ORDER BY name;

PRINT '########## PROCEDURES / FUNCTIONS ##########';
SELECT o.name, o.type_desc
FROM sys.objects o
WHERE o.type IN ('P','FN','IF','TF') AND o.is_ms_shipped=0
ORDER BY o.type_desc, o.name;

PRINT '########## TRIGGERS ##########';
SELECT t.name AS tbl, tr.name AS trigger_name, tr.is_disabled
FROM sys.triggers tr
JOIN sys.tables t ON tr.parent_id=t.object_id
ORDER BY t.name;
