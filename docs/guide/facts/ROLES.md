# ROLES.md — rank matrix

Four roles, ranks 1–4, named `viewer` (1), `engineer` (2), `manager` (3), `admin` (4).
- `sms/db/migrations/035_roles_and_answers.sql:45-46` renames the earlier `operator`/`supervisor`
  names to `viewer`/`engineer` (rank 1/2 unchanged; manager/admin renamed the same way further in
  the file).
- Client rank table: `sms/web/src/api.ts:144` — `export const ROLE_RANK: Record<string, number> = { viewer: 1, engineer: 2, manager: 3, admin: 4 };`
- Rank is computed once per signed-in session: `sms/web/src/App.tsx:495` — `const rank = ROLE_RANK[user.role] ?? 1;`

## Reading

**Every screen is open to every signed-in account, at every rank.** This includes all seven nav
screens (Line, Readings, Weight, Rejects, Sacks, Product, Report) plus Health. **Only Setup is
restricted**, to rank ≥ 4 — `sms/web/src/App.tsx:575` (`isAdmin={rank >= 4}`), matching the
server's `requireRole(4)` on every `/api/admin/*` route (table below). This is deliberate: IFL's
own representative confirmed the software's audience is the GM, managers and process engineers
of one department — there is no separate "read-only floor" tier. See `CLAUDE.md`, "⚠️ The user
base is ONE audience".

## Writing — the server-side gate is `requireRole(N)`, cross-checked against the client-side rank constants

| Action / route | Required rank | Server file:line | Client-side gate | Client file:line |
|---|---|---|---|---|
| Every `/api` route (floor) | 1 | `sms/api/src/app.ts:371` | — | — |
| Set/log the running product (`POST /api/current-product`) | 2 (engineer) | `sms/api/src/app.ts:1690` | `canWrite={rank >= ENGINEER_RANK}` | `sms/web/src/App.tsx:625` |
| Calibration adjustment (`POST /api/calibration/adjustments`) | 2 | `sms/api/src/app.ts:1589` | `canAdjust={rank >= ENGINEER_RANK}` | `sms/web/src/App.tsx:784` |
| Name a reject code (`PUT /api/reject-codes/:id`) | 2 | `sms/api/src/app.ts:1432` | `canName={rank >= ENGINEER_RANK}` | `sms/web/src/App.tsx:711`, `:809` |
| Record a sack movement (`POST /api/sacks/movements`) | 2 | `sms/api/src/routes/sacks.ts:149` | `canRecord={rank >= ENGINEER_RANK}` | `sms/web/src/App.tsx:726` |
| Local product limits (`POST /api/products/limits/local`) | 2 | `sms/api/src/routes/cone.ts:71` | `canWrite={rank >= ENGINEER_RANK}` | `sms/web/src/App.tsx:745` |
| Acknowledge a data-quality finding on Health (`POST /api/dq-findings/:id/ack`) — new 29 Sep 2026 | 2 (engineer) | `sms/api/src/routes/dqAck.ts:25` | `canAcknowledge={rank >= ENGINEER_RANK}` | `sms/web/src/App.tsx:767` |
| PDAS: create/retire/limits and pallet retire/reactivate (`POST /api/products`, `/api/products/:id/active`, `/api/products/:id/limits`, `/api/pallets/:id/active`) | `PDAS_WRITE_RANK` = 2 | `sms/api/src/app.ts:1790,1825,1849,1898` (rank const at `:1731`) | (same PDAS write gate) | — |
| PDAS: execute changeover (`POST /api/changeover/execute`) | `PDAS_WRITE_RANK` = 2 | `sms/api/src/routes/changeover.ts:173` | Execute button disabled unless writes on | `sms/web/src/screens/product/Changeover.tsx` |
| Export a report (`GET /api/reports/:type/export`) | `EXPORT_RANK` = 3 (manager) | `sms/api/src/routes/reports.ts:347` (rank const `sms/api/src/services/reports/common.ts`) | `canExport={rank >= EXPORT_RANK}` | `sms/web/src/App.tsx:205,653` |
| Export raw register (`GET /api/events/export`) | 3 | `sms/api/src/app.ts:1327` | — | — |
| Setup — every `/api/admin/*` route (users, line, machines, stations, sources, rules, audit) | 4 (admin) | `sms/api/src/app.ts` (each route individually gated `requireRole(4)`) | `isAdmin={rank >= 4}` | `sms/web/src/App.tsx:575`, `:767` (Health's admin-only PDAS block) |
| Reset another account's password (`POST /api/admin/users/:id/password`) | 4 | `sms/api/src/routes/ops.ts:182` | (inside Setup, already rank-4-only) | — |

## Historical mismatch, re-checked and confirmed fixed
The 3 Sep 2026 redesign notes in `CLAUDE.md` record a defect where the report Export button was
offered at rank 2 client-side while the server gated it at rank 3. Re-checked directly in this
pass: `EXPORT_RANK` is defined as **3** on both sides — client `sms/web/src/App.tsx:205`
(`const EXPORT_RANK = 3;`) and server `sms/api/src/services/reports/common.ts`
(`export const EXPORT_RANK = 3;`) — consumed server-side at
`sms/api/src/routes/reports.ts:347` (`requireRole(EXPORT_RANK)`). **No mismatch exists today.**
A dedicated regression test, `sms/web/src/rank.crosscheck.test.ts`, exists to keep every such
client/server rank pair mechanically in sync going forward. That test covers only roughly 6 of
the ~25-32 elevated-rank routes in the table above — see `LIMITATIONS.md` item 16 (RT-026, open):
the remaining routes are verified by reading the code, not by an automated guard.

## Verification status
`sms/web/src/rank.matrix.test.tsx` mounts the real app at all four ranks against a faked
`/api/auth/me` and proves the rendering rules above hold. **No one has yet signed in as a
viewer (rank 1) on a live running instance** — see `LIMITATIONS.md` item 19.
