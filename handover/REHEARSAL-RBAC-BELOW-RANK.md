# Live RBAC rehearsal: viewer (rank 1) and engineer (rank 2)

**Who does what:** the owner creates the two accounts (agents may never create logins or
accounts — `CLAUDE.md`'s working rules, and the "no agent-created accounts" feedback item in
memory). Once the accounts exist and the owner has signed in as each, the orchestrator (an
agent, in the browser pane) drives the checklist below and records the results. No account
creation, and no write is ever actually submitted against a live database by the checklist —
every write attempt below is either blocked by the UI (control absent) or, for the fetch
snippets, refused with 403 before reaching any write.

Ranks, from `sms.role` since migration 035: **1 viewer · 2 engineer · 3 manager · 4 admin**.

## 1. Create the accounts

From `sms/` (build the CLI first if `cli/dist` is stale: `npm run build --workspace @sms/cli`).
`DEPLOY.md`'s own documented invocation is `node cli/dist/index.js <command>`, not a bare `sms`
— use that form, not the shorthand `cli/src/index.ts`'s own usage banner prints for readability:

```
node cli/dist/index.js user:create --username=<owner's choice> --password=<owner's choice, meets PASSWORD_MIN_LENGTH> --role=viewer
node cli/dist/index.js user:create --username=<owner's choice> --password=<owner's choice> --role=engineer
```

Note the `=` in every `--flag=value` — `cli/src/context.ts`'s `parseArgs` only recognizes
`--key=value` (regex `^--([^=]+)(?:=(.*))?$`); a space-separated `--username value` form does
NOT work and silently sets `username` to `true` instead, taking `value` as a separate,
unmatched argument.

`--role` must be exactly one of `viewer | engineer | manager | admin` (`ROLES` in
`cli/src/commands/user.ts`) — the CLI refuses anything else and prints the valid set.
**`DEPLOY.md`'s own §"Wall mode" example (`--role=operator`) is stale** — `operator` predates
the 15 Sep 2026 role rename (migration `035_roles_and_answers.sql`) and is refused by the CLI
today; do not copy that example. Pick usernames that are obviously test fixtures, e.g.
`rbac-viewer-test` / `rbac-engineer-test`, so they are easy to find and remove later (see §6).

This writes one row to `sms.app_user` (via the CLI, exactly as `user:create` always does) and
one `sms.audit_log` row noting "by the CLI (sms user:create), no signed-in actor" — this is the
CLI's own documented behaviour, not a new write path, and not something this rehearsal invents.

## 2. Nav and screens — viewer pass

Sign in as the viewer account. `SCREENS` (`web/src/ui/Bar.tsx`) lists seven items:
`line, readings, weight, rejects, sacks, product, report`. The one-audience rule (`CLAUDE.md`,
"⚠️ The user base is ONE audience") means every one of these is open to every signed-in
account — only Setup is restricted, at rank ≥ 4 (`App.tsx:626`, `ADMIN_GATE`).

Checklist:

- [ ] Line loads and shows data (no 403, no blank screen).
- [ ] Readings loads.
- [ ] Weight loads.
- [ ] Rejects loads.
- [ ] Sacks loads.
- [ ] Product loads, and all four tabs open (Running / Changeover / Catalogue / History,
      `PRODUCT_TABS` in `web/src/ui/Bar.tsx`) — Changeover's PLAN action is rank 1 (a read; see
      `changeover.ts`'s own comment that `/api/changeover/{refs,plan}` never opens the PDAS
      writer pool), so a viewer can open the tab and run a dry-run plan; only EXECUTE is gated.
- [ ] Report loads.
- [ ] Setup does **not** appear in the nav, and navigating to it directly (if the URL is
      guessable) does not render the admin screen.

## 3. Write controls that must be ABSENT for a viewer (rank 1)

Every row below is a client control gated by a rank constant in `App.tsx` (or
`screens/report/model.ts`), each with the exact server route it POSTs/PUTs/PATCHes to and that
route's own `requireRole(N)` — the full, programmatically-verified list is
`web/src/rank.crosscheck.test.ts`'s `PAIRINGS` table (20 entries, cross-checked against 31
`requireRole` call sites; `EXEMPTIONS` in the same file lists 11 more gated routes with no
client-rank counterpart at all, mostly `/api/admin/*` paths reachable only via Setup, which is
already absent below rank 4).

| Control | Screen | Client gate | Route | Server `requireRole` |
|---|---|---|---|---|
| Register Export | Readings | `EXPORT_RANK` = 3 | `GET /api/events/export` | 3 |
| Change current product | Line / Product › Running | `ENGINEER_RANK` = 2 | `POST /api/current-product` | 2 |
| Record a sack movement | Sacks | `ENGINEER_RANK` = 2 | `POST /api/sacks/movements` | 2 |
| Name a reject code | Rejects / reason sheet | `ENGINEER_RANK` = 2 | `PUT /api/reject-codes/:id` | 2 |
| Record a calibration adjustment | Station sheet | `ENGINEER_RANK` = 2 | `POST /api/calibration/adjustments` | 2 |
| Changeover Execute | Product › Changeover | `ENGINEER_RANK` = 2 (via `canWrite`) | `POST /api/changeover/execute` | `PDAS_WRITE_RANK` (2) |
| Report CSV/XLSX/PDF export links | Report | `EXPORT_MIN_RANK` = 3 | `GET /api/reports/:type/export` | 3 |
| Setup itself (all admin forms) | Setup | `ADMIN_GATE` = 4 | `/api/admin/*`, `/api/admin/users/:id/password` | 4 |

For the viewer pass, checklist:

- [ ] No Export button/link on Readings.
- [ ] No "Change product" form/button on Line or Product › Running (view-only).
- [ ] No "record movement" form on Sacks.
- [ ] No rename control on Rejects or its reason sheet.
- [ ] No calibration-adjustment form on a station sheet.
- [ ] Product › Changeover shows the plan (read) but no Execute button.
- [ ] No CSV/XLSX/PDF export links on Report.
- [ ] Setup is entirely absent (already checked in §2).

## 4. Forced write attempts — confirm 403, not a write

For each row below, run the fetch **from the browser's own devtools console while signed in as
the viewer** (so the request carries the real session cookie) — a small snippet per route.
Every one of these routes' `requireRole` gate runs BEFORE any write logic, so a 403 here proves
the gate blocks the request outright; none of them touches a database row. **Do not run the
Changeover-execute one** — per the fix-wave brief, `/api/changeover/execute` is never called by
an agent, and it is excluded from this list for the same reason; its gate is already proven by
the identical `requireRole(PDAS_WRITE_RANK)` pattern the other rows use, so a separate live
403 check on it adds nothing this rehearsal needs.

```js
// Run each in the browser console, one at a time, signed in as viewer.
// All should return status 403 (Forbidden), not 200/201, and not 401
// (401 would mean "not signed in at all", a different failure).

await fetch('/api/events/export?from=2026-08-05&to=2026-08-06', { method: 'GET' }).then(r => r.status);
// expect 403

await fetch('/api/current-product', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
}).then(r => r.status);
// expect 403 (rejected by the rank gate before the body is even validated)

await fetch('/api/sacks/movements', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
}).then(r => r.status);
// expect 403

await fetch('/api/reject-codes/1', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
}).then(r => r.status);
// expect 403

await fetch('/api/calibration/adjustments', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
}).then(r => r.status);
// expect 403

await fetch('/api/reports/daily/export?format=csv&from=2026-08-05&to=2026-08-06', { method: 'GET' }).then(r => r.status);
// expect 403

await fetch('/api/admin/users', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
}).then(r => r.status);
// expect 403
```

Checklist: every response above is `403`, none is `200`/`201`/`500`, and no row in any table
changes as a result (nothing here reaches a write — the `requireRole` gate is `app.<method>`'s
own middleware, executed first).

## 5. Engineer pass (rank 2)

Sign out, sign in as the engineer account. Re-run §2's nav checklist (all seven screens, same
expectations). Then:

- [ ] "Change current product" form/button now appears on Line / Product › Running, and works
      (the write succeeds — this one DOES reach `sms.current_product`/`product_change`, a real,
      intended write for an engineer; that is expected, not a defect).
- [ ] "Record movement" form appears on Sacks.
- [ ] Reject-code rename control appears on Rejects and the reason sheet.
- [ ] Calibration-adjustment form appears on a station sheet.
- [ ] Product › Changeover's Execute button now appears (rank 2 meets `PDAS_WRITE_RANK`) —
      **do not click it**; its presence is what this rehearsal checks, not a live PDAS write,
      which is item B's rehearsal (`REHEARSAL-RT24-05-EXECUTE-ONLY.md`), not this one.
- [ ] Register Export (rank 3) is still ABSENT — an engineer is rank 2, one below `EXPORT_RANK`.
- [ ] Report's CSV/XLSX/PDF export links (rank 3, `EXPORT_MIN_RANK`) are still ABSENT.
- [ ] Setup is still absent (rank 4).

Re-run the forced-fetch snippets from §4 as the engineer: `/api/current-product`,
`/api/sacks/movements`, `/api/reject-codes/:id`, `/api/calibration/adjustments` should now be
reachable by rank (do not actually submit real data with them — the UI forms in the previous
bullet already prove reachability; there is no need to fire a raw fetch that would write a real
row). `/api/events/export`, `/api/reports/:type/export`, and `/api/admin/*` should still return
403 — an engineer is below all three of those gates (3, 3, 4).

## 6. Cleanup

Two options, either is fine — record which one was used:

**A — deactivate (keeps the audit trail, reversible):** via Setup (signed in as admin/owner),
Admin Users, toggle each test account inactive. This uses `PATCH /api/admin/users/:id`
(`adminUpdateUser`), the same route §3's table already lists — the intended, gated path, not a
new one.

**B — keep as permanent test fixtures:** leave `rbac-viewer-test` / `rbac-engineer-test` active,
clearly named, for any future rehearsal of this kind. If kept, note their usernames in
`DEPLOY.md`'s own test-account list (owner's call, not this document's) so a future audit does
not mistake them for a real, unexplained account.

Do not delete the `sms.app_user` rows outright unless the owner specifically wants no trace —
`sms.audit_log` and `sms.product_change` may already reference the account by id, and deleting
the user row would orphan those references for no benefit deactivation does not already give.

## 7. Results template

```
Date/time run:
Operator (who signed in as each account):

Accounts created:
  viewer username: ____________   role confirmed: ____________
  engineer username: ____________   role confirmed: ____________

VIEWER PASS
  Nav (7 screens load, Setup absent): PASS/FAIL, notes:
  Write controls absent (8 rows in §3's table): PASS/FAIL, notes:
  Forced fetches (7 routes, all 403): PASS/FAIL, paste any non-403 status:

ENGINEER PASS
  Nav (7 screens load, Setup absent): PASS/FAIL, notes:
  Rank-2 controls appear (5 items): PASS/FAIL, notes:
  Rank-3/4 controls still absent (Export x2, Setup): PASS/FAIL, notes:
  Forced fetches (403 on Export/Setup only): PASS/FAIL, notes:

Cleanup: A (deactivated) / B (kept as fixtures), confirmed: ____________

Overall verdict: PASS / FAIL / INCONCLUSIVE, with why:
```

## What this rehearsal does NOT cover

- Manager (rank 3) and admin (rank 4) are not re-rehearsed here — `rank.matrix.test.tsx`
  (Phase 8) already proves all four ranks render correctly against a faked `/api/auth/me`, and
  `rank.crosscheck.test.ts` proves every client gate matches its server route. This rehearsal's
  job is the one thing neither test can do: an actual signed-in session on the real app, which
  has never happened for any rank below admin (`CLAUDE.md`'s Phase 7/8 sections, "no viewer has
  ever signed in").
- It does not touch `/api/changeover/execute` at all, by design — see §4 and §5.
- It does not touch PDAS, `PDAS_WRITE_ENABLED`, or any live write path — that is
  `REHEARSAL-RT24-05-EXECUTE-ONLY.md`'s job, a separate rehearsal with its own separate
  `:4600` process.
