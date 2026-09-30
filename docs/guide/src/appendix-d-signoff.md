# Sign-off sheet {appendix #appendix-signoff}

Use this sheet to record that installation was completed and verified. Keep
a signed copy with IFL's own records.

## Installation

- [ ] Prerequisites confirmed ({{ref:prereqs}})
- [ ] Read-only login obtained from IFL's DBA ({{ref:install-ifl-login}})
- [ ] App database and logins created ({{ref:install-app-db}})
- [ ] `.env` created and filled in ({{ref:install-env}})
- [ ] Build completed with no errors ({{ref:install-build}})
- [ ] Migrations applied ({{ref:install-migrate}})
- [ ] First admin account created ({{ref:install-first-admin}})
- [ ] Manager/engineer accounts created ({{ref:install-manager-accounts}})
- [ ] Windows services registered and running ({{ref:install-services}})
- [ ] Firewall rule added ({{ref:install-firewall}})
- [ ] First sync completed, generation accepted, `verify` clean ({{ref:install-first-connection}})
- [ ] Scheduled tasks registered ({{ref:install-scheduled-tasks}})
- [ ] Wall display configured, if in scope ({{ref:install-wall-pc}})

## Verification

- [ ] Every item in {{ref:verification}} ticked off
- [ ] A backup has run and been confirmed restorable ({{ref:backups}})
- [ ] Sign-in tested for at least one account of each role in use

## Sign-off

| Field | |
|---|---|
| Installed by (name) | `_________________________` |
| Installed by (signature) | `_________________________` |
| Date | `_________________________` |
| Confirmed by IFL (name) | `_________________________` |
| Confirmed by IFL (signature) | `_________________________` |
| Date | `_________________________` |

> **Note:** Signing this sheet confirms only that the installation and
> verification checklists above were completed; the known limitations in
> Appendix C stay open items for IFL and the maintainer.
