# Request: a dedicated login for SMS to write product data to PDAS

24 September 2026
To: Hassan sb, and IFL's database administrator

## 1. Thank you, and what this letter is for

Thank you for the go-ahead you gave over WhatsApp on 19 September, allowing SMS to work
on the PDAS product database. This letter turns that go-ahead into something your DBA can
act on: a specific, limited database login, with the exact grant script attached below.

## 2. What the login would be allowed to do

Nine rights in total, all on the PDAS database, nothing else:

| Right | In plain terms |
|---|---|
| CreateMaterial | Add a new product |
| SetMaterialStatusActive | Retire or reactivate a product |
| AddBlend | Add a new blend entry |
| AddCount | Add a new count entry |
| AddTubeType | Add a new tube type entry |
| CreatePallet | Add a new pallet entry |
| SetPalletStatusActive | Retire or reactivate a pallet entry |
| UPDATE on dbo.Materials | Change one product's weight setpoint or limits (a single guarded row, nothing else in the table) |
| INSERT on dbo.nhs_events | Record that change in PDAS's own event log, the same way your own screens do |

Alongside these nine, the login would also need plain read access (SELECT) to the five
tables it writes to or reads reference data from: Materials, Blends, Counts, TubeTypes,
Pallets. This is so the software can check, after every write, that PDAS actually holds
what it expects, rather than assuming the write went through.

Nothing beyond this. No other tables, no DELETE, no schema changes of any kind.

## 3. Why we ask to change a product record in place, rather than retire it and add it again

Our first instinct was to retire an old product record and create a fresh one whenever a
setpoint needed to change. We tested this on our own copy of your data on 23 September,
and it fails: CreateMaterial refuses to add a product that shares the same blend, count,
and tube type combination as one already in the database, even after the old one has been
retired. Your own event log shows this exact failure occurring on your side on 18 August
2026 (event log entries 23204, 23206, 23207, 23208, for Material 1022). Our test reproduced
the identical error.

Because of this, the only reliable way to change a setpoint is a direct, guarded update to
the one row in question, which is why the UPDATE right above is needed.

## 4. The shape of the login

We are asking for a dedicated SQL login, `sms_pdas_writer`, not a shared or personal one.
This is for three reasons: changes made by the software should be traceable back to the
software, not appear in your logs as a person's manual edit; the login's password can be
changed at any time without affecting anyone's personal access; and it does not depend on
who happens to hold a particular role at IFL.

The login should have exactly the nine rights above, plus the five read (SELECT) rights
listed in section 2. No membership in any database role, no permission to change table
structure, no DELETE on any table, and no access at all to the DATA_TP1U2 database.

## 5. The script for your DBA to run

The grant statements below are exact, copied unchanged from the full script, which is
attached to this letter as `12_pdas_writer.sql`. Your DBA can run the whole script as-is;
it will create the login if it does not already exist, and is safe to run more than once.

```sql
GRANT EXECUTE ON OBJECT::dbo.CreateMaterial          TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.SetMaterialStatusActive TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.AddBlend                TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.AddCount                TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.AddTubeType             TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.CreatePallet            TO [sms_pdas_writer];
GRANT EXECUTE ON OBJECT::dbo.SetPalletStatusActive   TO [sms_pdas_writer];
GRANT UPDATE ON OBJECT::dbo.Materials  TO [sms_pdas_writer];
GRANT INSERT ON OBJECT::dbo.nhs_events TO [sms_pdas_writer];
GRANT SELECT ON OBJECT::dbo.Materials  TO [sms_pdas_writer];
GRANT SELECT ON OBJECT::dbo.Blends     TO [sms_pdas_writer];
GRANT SELECT ON OBJECT::dbo.Counts     TO [sms_pdas_writer];
GRANT SELECT ON OBJECT::dbo.TubeTypes  TO [sms_pdas_writer];
GRANT SELECT ON OBJECT::dbo.Pallets    TO [sms_pdas_writer];
```

Run against the PDAS server (`TP1-PDAS\PDAS`), with the real database name filled in for
`PdasDb`. The command is:

```
sqlcmd -S TP1-PDAS\PDAS -E -i 12_pdas_writer.sql ^
       -v PdasDb="PDAS_TP1U2" -v WriterPassword="<a strong password of your choosing>"
```

Your DBA should choose the password. Please do not send it to us by email or in any
document — pass it to the SMS project owner directly, by phone or in person.

## 6. What happens next

We will complete our own end-to-end test against the local copy of your data before this
login is ever used against your live systems. The login is used by the SMS software itself,
not by any person signing in directly; process engineers will use SMS to change a product's
setpoint or limits on the floor, and SMS will use this login behind the scenes to make that
change in PDAS. We will notify you before the very first write reaches the plant database.

Thank you again for your time on this.
