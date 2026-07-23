/** `sms sync` — run one full pass (seed, Reader→raw, Transform→canonical). */
import { openContext } from '../context.js';
import { runFullSync } from '@sms/sync-worker';

export async function sync(): Promise<number> {
  const ctx = await openContext({ needIfl: true });
  try {
    const started = Date.now();
    const { reader, transform } = await runFullSync(ctx.app, ctx.ifl, ctx.cfg);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    for (const o of reader) {
      console.log(`  raw ${o.table.replace('sms_raw.', '').padEnd(20)} read=${o.read} written=${o.written}`);
    }
    for (const o of transform) {
      console.log(`  canon ${o.table.padEnd(14)} read=${o.read} written=${o.written}`);
    }
    console.log(`done in ${secs}s`);
    return 0;
  } finally {
    await ctx.close();
  }
}
