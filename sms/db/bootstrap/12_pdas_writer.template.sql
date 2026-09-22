/*
  sms_pdas_writer — the login SMS uses to write product data to PDAS.

  WHO RUNS THIS. On the plant, IFL's own DBA, against the PDAS host
  (TP1-PDAS\PDAS, 192.168.100.37 — see DEPLOY.md, "The real PDAS host").
  On a development machine, the owner, against the local PDAS_TP1U2_SEP07
  copy, so the write path can be proven offline before it is ever pointed
  at the plant.

  WHY A DEDICATED LOGIN, and not the one in IFL's own screenshots. Every
  procedure call IFL demonstrated ran under a named personal login. An
  application writing as a person is wrong three ways: its changes are
  indistinguishable from that person's manual edits in PDAS's own event
  log; the password cannot be rotated without locking that person out;
  and the dependency breaks the day they change role.

  THE NINE RIGHTS. This grants exactly what the write path uses and
  nothing else. No DDL, no DELETE, no other table, ever.

      EXECUTE   CreateMaterial
      EXECUTE   SetMaterialStatusActive
      EXECUTE   AddBlend
      EXECUTE   AddCount
      EXECUTE   AddTubeType
      EXECUTE   CreatePallet
      EXECUTE   SetPalletStatusActive
      UPDATE    dbo.Materials        (the vendor supplies no UPDATE proc;
                                      a setpoint change is one guarded
                                      single-row UPDATE)
      INSERT    dbo.nhs_events       (the vendor's own event-log row,
                                      written alongside that UPDATE)

  RUN IT:
      sqlcmd -S <server\instance> -E -i db\bootstrap\12_pdas_writer.template.sql ^
             -v PdasDb="PDAS_TP1U2_SEP07" -v WriterPassword="<a strong unique password>"

  Then put that password in .env as PDAS_WRITE_PASSWORD. Never commit it.

  Idempotent: safe to re-run. It creates what is missing and re-applies
  the grants without disturbing anything else.
*/

:setvar PdasDb "PDAS_TP1U2_SEP07"

USE [master];
GO

IF SUSER_ID(N'sms_pdas_writer') IS NULL
BEGIN
    CREATE LOGIN [sms_pdas_writer]
        WITH PASSWORD = N'$(WriterPassword)',
             CHECK_POLICY = ON,
             DEFAULT_DATABASE = [$(PdasDb)];
    PRINT 'created login sms_pdas_writer';
END
ELSE
    PRINT 'login sms_pdas_writer already exists — left as it is';
GO

USE [$(PdasDb)];
GO

IF DATABASE_PRINCIPAL_ID(N'sms_pdas_writer') IS NULL
BEGIN
    CREATE USER [sms_pdas_writer] FOR LOGIN [sms_pdas_writer];
    PRINT 'created database user sms_pdas_writer';
END
GO

/* The seven procedures. EXECUTE only — never ALTER, never VIEW DEFINITION
   beyond what EXECUTE implies. */
GRANT EXECUTE ON OBJECT::dbo.CreateMaterial          TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.SetMaterialStatusActive TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.AddBlend                TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.AddCount                TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.AddTubeType             TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.CreatePallet            TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.SetPalletStatusActive   TO [sms_pdas_writer];
GO

/* The two direct rights. UPDATE on Materials because the vendor ships no
   UPDATE procedure for a limits change; INSERT on nhs_events so that
   change is recorded in the vendor's own event log the way its own
   procedures record theirs. Note there is deliberately no DELETE and no
   INSERT on Materials — a new product goes through CreateMaterial. */
GRANT UPDATE ON OBJECT::dbo.Materials  TO [sms_pdas_writer];
GRANT INSERT ON OBJECT::dbo.nhs_events TO [sms_pdas_writer];
GO

/* SELECT on the reference tables the write path reads back after each
   write, so it can confirm what PDAS actually holds rather than assuming
   the procedure did what it was asked. Read-only. */
GRANT SELECT ON OBJECT::dbo.Materials  TO [sms_pdas_writer];
GRANT SELECT ON OBJECT::dbo.Blends     TO [sms_pdas_writer];
GRANT SELECT ON OBJECT::dbo.Counts     TO [sms_pdas_writer];
GRANT SELECT ON OBJECT::dbo.TubeTypes  TO [sms_pdas_writer];
GRANT SELECT ON OBJECT::dbo.Pallets    TO [sms_pdas_writer];
GO

PRINT 'sms_pdas_writer: nine write rights + read-back SELECTs applied on $(PdasDb)';
GO
