/** `sms verify` — reconcile source ⇄ raw ⇄ canonical, list DQ findings. */
import mssql from 'mssql';
import { openContext } from '../context.js';

interface Stream {
  name: string;
  srcTable: string; // IFL
  rawTable: string; // sms_raw
  canonWhere: string; // predicate on canonical table
  canonTable: string;
}

const STREAMS: Stream[] = [
  { name: 'cone', srcTable: 'pack1_TP1U2', rawTable: 'sms_raw.cone_raw', canonTable: 'sms.cone_event', canonWhere: '1=1' },
  { name: 'sack', srcTable: 'sack1_TP1U2', rawTable: 'sms_raw.sack_raw', canonTable: 'sms.sack_event', canonWhere: '1=1' },
  { name: 'reject_qcs', srcTable: 'rejectQCS1_TP1U2', rawTable: 'sms_raw.reject_qcs_raw', canonTable: 'sms.reject_event', canonWhere: "reject_type='quality'" },
  { name: 'reject_weight', srcTable: 'rejectWeight1_TP1U2', rawTable: 'sms_raw.reject_weight_raw', canonTable: 'sms.reject_event', canonWhere: "reject_type='weight'" },
];

async function count(pool: mssql.ConnectionPool, sql: string): Promise<number> {
  const r = await pool.request().query<{ n: number }>(sql);
  return r.recordset[0]?.n ?? 0;
}

export async function verify(): Promise<number> {
  const ctx = await openContext({ needIfl: true });
  let bad = 0;
  try {
    console.log('Reconciliation  (source ⇄ raw ⇄ canonical)');
    console.log('  stream          source      raw   canonical   status');
    console.log('  ------------- -------- -------- ----------- --------');
    for (const s of STREAMS) {
      const src = await count(ctx.ifl, `SELECT COUNT(*) n FROM ${s.srcTable}`);
      const raw = await count(ctx.app, `SELECT COUNT(*) n FROM ${s.rawTable}`);
      const can = await count(ctx.app, `SELECT COUNT(*) n FROM ${s.canonTable} WHERE ${s.canonWhere}`);
      const ok = src === raw && raw === can;
      if (!ok) bad++;
      console.log(
        `  ${s.name.padEnd(13)} ${String(src).padStart(8)} ${String(raw).padStart(8)} ${String(can).padStart(11)}   ${ok ? 'OK' : 'MISMATCH'}`,
      );
    }

    const collisions = await count(
      ctx.app,
      'SELECT COUNT(*) n FROM sms.cone_event WHERE merge_key_is_unique = 0',
    );
    console.log(`\nMerge-key collisions (cone, DQ-2): ${collisions}`);

    const dq = await ctx.app.request().query<{ severity: string; n: number }>(
      `SELECT severity, COUNT(*) n FROM sms.dq_finding GROUP BY severity`,
    );
    const order = ['CRITICAL', 'ERROR', 'WARNING', 'INFO'];
    const bySev = new Map(dq.recordset.map((r) => [r.severity, r.n]));
    console.log('DQ findings: ' + order.map((s) => `${s}=${bySev.get(s) ?? 0}`).join('  '));

    console.log(bad === 0 ? '\n✓ all streams reconcile' : `\n✗ ${bad} stream(s) mismatched`);
    return bad === 0 ? 0 : 1;
  } finally {
    await ctx.close();
  }
}
