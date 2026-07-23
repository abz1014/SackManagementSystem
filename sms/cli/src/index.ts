#!/usr/bin/env node
/** sms CLI dispatcher (ARCHITECTURE §18). */
import { verify } from './commands/verify.js';
import { summary } from './commands/summary.js';
import { sync } from './commands/sync.js';
import { rebuild } from './commands/rebuild.js';
import { userCreate } from './commands/user.js';

function help(): void {
  console.log(`sms — Sack Management System CLI

  sms sync                          run one full pass (reader→raw→transform→canonical)
  sms verify                        reconcile source ⇄ raw ⇄ canonical; list DQ findings
  sms summary [--date=YYYY-MM-DD]   print totals (cones/rejects/sacks/weight) [--shift=]
  sms rebuild --table=<t> --snapshot-id=<id>   rebuild canonical from raw (snapshot-gated)
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
      code = await verify();
      break;
    case 'summary':
      code = await summary(rest);
      break;
    case 'rebuild':
      code = await rebuild(rest);
      break;
    case 'user:create':
      code = await userCreate(rest);
      break;
    default:
      help();
      code = cmd ? 1 : 0;
  }
  process.exit(code);
}

main().catch((err) => {
  console.error('cli error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
