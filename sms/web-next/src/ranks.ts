/**
 * The ONE place web-next names a rank. A write gate in web-next must use one
 * of these names (or the literal 1, "everyone signed in"), never its own
 * number: `web/src/rank.crosscheck.test.ts` reads this file and fails if a
 * value here differs from the web app's gate or from the server's
 * `requireRole` for the same action (the 3 Sep 2026 EXPORT_RANK defect).
 *
 * 1 viewer · 2 engineer · 3 manager · 4 admin.
 */
export { EXPORT_MIN_RANK, REPORT_MIN_RANK } from '../../web/src/screens/report/model';
export { ADMIN_RANK } from './ui/nav';

/** Product, sack, reject-label, calibration and DQ-acknowledge writes (server: requireRole(2) / ENGINEER_RANK / PDAS_WRITE_RANK). */
export const ENGINEER_RANK = 2;
