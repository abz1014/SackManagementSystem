# REDACTION.md — denylist and placeholders

Rule: nothing on the denylist below may appear in any guide output (source markdown, built
docx/PDF, or screenshot). Writers substitute the placeholder; screenshots are scanned for the
denylist text (plus the hostname and Windows username, read at runtime) before being saved.

## Denylist, with what was found and where (this pass, grep-verified)

| Real value | Placeholder | Found at (this pass) |
|---|---|---|
| `TP1-PDAS` (real host) | `SERVER-PDAS` | `sms/DEPLOY.md:688`, `:690` (twice: `server TP1-PDAS`, `TP1-PDAS\PDAS`) |
| `192.168.100.37` (real IP) | `192.168.1.x` | `sms/DEPLOY.md:690` |
| `ibrahim` (personal login — case-sensitive, word-bounded; must NOT match "Ibrahim Fibres", the company name) | `<plant login>` | `sms/DEPLOY.md:28`, `:692` (×2 on that line: connection panel + VNC title), `:693`, `:694` (`ibrahim`'s), `:695` — 5 lines, 6 occurrences total, none of them the company name |
| `PLANT\svc-sms` (example domain account) | `DOMAIN\svc-sms` | Not currently present anywhere in `sms/DEPLOY.md`, `sms/.env.example`, or `sms/db/migrations/*.sql` (grepped, zero hits) — kept on the denylist in case it is reintroduced; the CLAUDE.md note that flagged it may describe an earlier draft of DEPLOY.md |
| `DATA_TP1U2_SEP07` (dev database name) | `DATA_TP1U2` (generic) or `<dev sidecar DB>` | `sms/db/migrations/025_source_epoch.sql:5` |
| `PDAS_TP1U2_SEP07` (dev database name) | `PDAS_TP1U2` (generic) or `<dev PDAS copy>` | `sms/db/migrations/040_product_limit_true_start.sql:39`, `sms/db/migrations/041_tube_type_form.sql:4` |
| The machine's hostname (read at runtime via `$env:COMPUTERNAME`, never hard-coded in the guide) | `<host>` | n/a — runtime check only |
| Windows username `ABDULLAH SAJID` | `<IT user>` or `C:\Users\<user>\` | Not found in `sms/DEPLOY.md`/`.env.example`/migrations this pass — still denylisted, since it appears in this machine's own file paths outside `sms/` (e.g. the repo root) and could leak into a screenshot's title bar or a copied file path |
| `C:\Users\` (any path under it, as a stand-in for the previous item) | `C:\sms\` / `C:\IT\` per the package's own placeholder paths | — |
| Dev port `14330` | `<PDAS port>` | `sms/.env.example:69` (comment, "PDAS_WRITE_PORT=14330 (the local named instance's TCP port...)"), `:73` (`PDAS_WRITE_PORT=14330`) |
| A person's first name in migration comments — `Hassan sb`, 3 occurrences | `IFL's process engineer` / `IFL's answer` | `sms/db/migrations/035_roles_and_answers.sql:1` ("IFL's answers of 15 Sep 2026 (via Hassan sb)"), `sms/db/migrations/036_pallet_mirror.sql:4` ("as relayed by Hassan sb on 15 Sep 2026"), `sms/db/migrations/038_sms_local_limits.sql:5` ("(Hassan sb, question pack)") — these are code comments, not UI text; never quote them verbatim in the guide |

## Allowed (not redacted)

- `IFL`, `Ibrahim Fibres Limited` — the company name. **Case-sensitive, word-bounded pattern
  required** so this is never conflated with the lowercase personal login `ibrahim` above.
- `TP1U2` — IFL's own line code, part of source table names (`pack1_TP1U2`, `sack1_TP1U2`,
  `rejectQCS1_TP1U2`, `rejectWeight1_TP1U2`) and part of the customer identity; treated as
  allowed per the plan's own §1.7 note.
- Documented generic role/login names, confirmed present in `sms/DEPLOY.md`: `sms_app`
  (`sms/DEPLOY.md:32,35,195,225,231,421`), `sms_migrate` (`:32,195,234`), `sms_readonly`
  (`:122`), `sms_backup` (`:420,421,428,430,431,434`), `sms_pdas_writer` (`:29,688,692`),
  `SMS-Api` (`:299,348-353,357,366-367,402`), `SMS-Sync` (`:340-345,356,358,362-364,402,406`).
- Demo names created for this guide's own demo system: `SMS_DEMO`, `DATA_DEMO_SIM`,
  `PDAS_DEMO`, `demo-admin`.

## Machine-readable denylist (regex per line, case-sensitive unless noted)

```
TP1-PDAS
192\.168\.100\.37
\bibrahim\b
PLANT\\svc-sms
DATA_TP1U2_SEP07
PDAS_TP1U2_SEP07
\b14330\b
\bHassan\b
ABDULLAH SAJID
C:\\Users\\
```

Notes on the machine form:
- `\bibrahim\b` is deliberately case-sensitive (do not add `-i`) and word-bounded so
  "Ibrahim Fibres Limited" never matches.
- The hostname is not a literal in this list because it is read at runtime
  (`$env:COMPUTERNAME`) by the capture/check scripts and appended to the live scan; it is not
  known statically at the time this file is written.
- `ABDULLAH SAJID` and `C:\Users\` are included defensively even though no current hit was
  found in `sms/DEPLOY.md`, `sms/.env.example`, or `sms/db/migrations/*.sql` — they are real
  risks in a screenshot's window title, file-save dialog, or an incautiously copied path.
