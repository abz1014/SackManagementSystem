# Contacts and escalation {#contacts}

| Role | Contact | When to use |
|---|---|---|
| IFL IT / SMS administrator | `<IT contact name and phone/email>` | Account issues, installation, service restarts, backups. |
| IFL process department lead | `<process department contact>` | Questions about how a report or figure should be read, or a request to change a role. |
| SMS maintainer / developer | `<maintainer contact>` | A defect, an unclear finding on [[Health]] that Chapter 8 does not explain, or a request to extend SMS. |
| IFL's database administrator | `<DBA contact>` | The read-only login (`sms_readonly`), or anything on IFL's own `DATA_TP1U2`/`PDAS_TP1U2` databases. |

> **Note:** Fill in the placeholders above with IFL's own current contacts
> before distributing this guide.

## Escalation order

1. Check [[Health]] and `GET /api/health` — both are designed to state what
   is wrong in plain words.
1. Check {{ref:troubleshooting}} for the symptom.
1. Contact the IFL IT / SMS administrator.
1. If the cause is inside SMS's own code rather than the local environment,
   the administrator escalates to the SMS maintainer.
