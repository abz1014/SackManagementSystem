#!/usr/bin/env node
/** sms CLI dispatcher (ARCHITECTURE §18). */
import { verify } from './commands/verify.js';
import { summary } from './commands/summary.js';
import { sync } from './commands/sync.js';
import { rebuild } from './commands/rebuild.js';
import { cutover } from './commands/cutover.js';
import { epochList, epochAccept, epochPurge, epochDrop } from './commands/epoch.js';
import { userCreate, userPassword } from './commands/user.js';
import { retention } from './commands/retention.js';
import { cliLog } from './context.js';

function help(): void {
  console.log(`sms — Sack Management System CLI

  sms sync                          run one full pass (reader→raw→transform→canonical)
  sms verify [--weights]            reconcile source ⇄ raw ⇄ canonical; list DQ findings
                                    (--weights: also COUNT/SUM/AVG/MIN/MAX of every weight column)
  sms summary [--date=YYYY-MM-DD]   print totals (cones/rejects/sacks/weight) [--shift=]
  sms rebuild --table=<t> --snapshot-id=<id> (--epoch=N[,M] | --all-generations) --confirm
                                    delete a canonical table's rows for the NAMED source
                                    generation(s) and re-derive them from sms_raw.* (which is
                                    not touched). The generation scope is REQUIRED and has no
                                    default: until 23 Sep 2026 this command scoped by
                                    source_system alone and rebuilt every generation at once.
                                    Prints what it will delete and re-derive, per generation,
                                    and refuses without --confirm.
  sms cutover --confirm --backup=<path.bak>
                                    clear raw/canonical + gate baselines, keep users, products,
                                    labels, rules and audit; refuses without an existing backup
                                    file named, or while a worker pass is in flight
  sms retention [--dry-run]         prune sync_run (>RETENTION_SYNC_RUN_DAYS, newest per table kept),
                                    non-critical dq_finding (>RETENTION_DQ_FINDING_DAYS), expired
                                    sessions. Never audit_log, product_change, raw or canonical.
  sms user:create --username=<u> --password=<p> --role=<r>
  sms user:password --username=<u> --password=<p>
                                    set a password (PASSWORD_MIN_LENGTH applies); revokes the
                                    account's sessions

  sms epoch:list                    show every source generation and its rows
  sms epoch:accept --all|--table=<t> --confirm --provenance=<ifl_live|ifl_copy|simulator> [--label=".."]
                                    register the generation the source now reports.
                                    --provenance is REQUIRED and has no default: see
                                    cli/src/commands/epoch.ts for the mislabelled
                                    generation that removed it.
  sms epoch:purge --epoch=N[,M] --confirm --backup=<path.bak>
                                    delete an epoch's rows, keep the tombstone (same gates as cutover)
  sms epoch:drop --epoch=N --confirm        remove an epoch row that has no rows
`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  let code = 0;
  switch (cmd) {
    case 'sync':
      code = await sync();
      break;
    case 'verify':
      code = await verify(rest);
      break;
    case 'summary':
      code = await summary(rest);
      break;
    case 'rebuild':
      code = await rebuild(rest);
      break;
    case 'cutover':
      code = await cutover(rest);
      break;
    case 'epoch:list':
      code = await epochList();
      break;
    case 'epoch:accept':
      code = await epochAccept(rest);
      break;
    case 'epoch:purge':
      code = await epochPurge(rest);
      break;
    case 'epoch:drop':
      code = await epochDrop(rest);
      break;
    case 'user:create':
      code = await userCreate(rest);
      break;
    case 'user:password':
      code = await userPassword(rest);
      break;
    case 'retention':
      code = await retention(rest);
      break;
    default:
      help();
      code = cmd ? 1 : 0;
  }
  process.exit(code);
}

main().catch((err) => {
  // Human-readable on stderr as before, AND one structured line (Phase 2
  // item 6) so a CLI failure in a scheduled task lands in the same log
  // shape as the worker's.
  console.error('cli error:', err instanceof Error ? err.message : err);
  cliLog.error('cli command failed', { command: process.argv[2] ?? null, error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
