# Security {#security}

## Logins and least privilege {#logins}

SMS uses five distinct SQL logins, each scoped to exactly what it needs —
never one shared login for everything:

| Login (generic name) | Access |
|---|---|
| `sms_app` | The app database only — the API and sync worker's normal connection. |
| `sms_migrate` | The app database only, used solely for running migrations, set in the invoking shell rather than `.env`. |
| `sms_readonly` | `db_datareader` on IFL's `DATA_TP1U2` and `PDAS_TP1U2` only — never write access, never any other database. |
| `sms_pdas_writer` | A separate login, used only if the PDAS write path in {{ref:pdas-writes}} is turned on — distinct from `sms_readonly` by design, so a compromised read-only connection can never write. |
| `sms_backup` | `db_backupoperator` on the app database, used by the scheduled backup task. |

SMS never reuses `DATA_TP1U2.Users` (IFL's own existing table there holds
plaintext passwords) — every SMS account is a fresh, hashed-password account
in SMS's own database.

## Protecting `.env` {#protecting-env}

`.env` holds every database password SMS uses. Restrict its file permissions
to the account the services run as and to administrators only; never email
it, commit it to version control, or copy it into a support ticket.
`backup-config.ps1` (see {{ref:backups}}) copies it into an ACL-locked
folder as part of the configuration backup — treat that backup folder with
the same care as `.env` itself.

## Password policy {#password-policy}

Every account password must be at least `PASSWORD_MIN_LENGTH` characters
(default 10, configurable 6–128 — see Appendix A). Passwords are hashed
(argon2), never stored or logged in plain text. Resetting a password from
[[Setup]] revokes every existing session for that account immediately.

## Sessions {#sessions}

SMS uses server-side session cookies, not tokens the browser can decode.
`COOKIE_SECURE` must be `true` once served over HTTPS — see {{ref:env-keys}}.
Signing out from the user menu's [[Sign out]] item ends that one session;
resetting a password from [[Setup]] ends every session for that account.

## Roles {#security-roles}

See {{ref:roles-table}} for the full rank table. Every screen is readable by
every signed-in account; writing is gated by rank, and [[Setup]] is the only
screen restricted outright, to `admin`.

## Audit log {#audit-log}

Every write SMS itself makes — account changes, calibration adjustments,
product changes, PDAS write attempts — is recorded in the [[Audit log]]
block on [[Setup]], including who made it and when. So are acknowledgements
of data findings (with the reason given) and any use of the
`--i-know-this-is-a-new-generation` override on `epoch:accept`.

## TLS {#security-tls}

See {{ref:tls}} in Chapter 6 for how to configure it. On an isolated,
plant-only LAN, plain HTTP with `COOKIE_SECURE=false` is a defensible choice
IFL can make; on any network reachable more broadly, TLS should be turned
on.

## Air-gapped operation {#air-gapped}

The plant PC has no internet access, and SMS is designed around that: no
cloud dependency, no email alerting (see Appendix C, item 13), and
`GET /api/health` is meant to be polled by whatever monitoring tool the
plant already runs on its own network, rather than SMS reaching out itself.

## The separate PDAS writer {#security-pdas-writer}

See {{ref:pdas-writes}}. The PDAS write path uses its own login
(`sms_pdas_writer`), separate from the read-only login used for everything
else, specifically so that turning PDAS writes on or off is a single,
auditable switch (`PDAS_WRITE_ENABLED`) that never affects the read-only
connection's own permissions.
