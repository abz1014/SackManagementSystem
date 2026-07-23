/**
 * `sms summary [--date=YYYY-MM-DD] [--shift=morning|evening|night]`
 * Prints IFL's four priority metrics from canonical, honouring the weight basis
 * (Q4/Q5) read from the current weight_rule. Defaults to the latest shift_date.
 */
import mssql from 'mssql';
import { openContext, parseArgs } from '../context.js';

export async function summary(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const ctx = await openContext();
  try {
    const line = ctx.cfg.lineId;

    const date =
      typeof args.date === 'string'
        ? args.date
        : (
            await ctx.app.request().query<{ d: string }>(
              `SELECT CONVERT(varchar(10), MAX(shift_date), 120) d FROM sms.cone_event WHERE line_id=${line}`,
            )
          ).recordset[0]?.d;
    if (!date) {
      console.log('No data.');
      return 0;
    }
    const shift = typeof args.shift === 'string' ? args.shift : null;
    const shiftClause = shift ? 'AND shift_code = @shift' : '';

    const req = () => {
      const r = ctx.app.request().input('d', mssql.Date, date);
      if (shift) r.input('shift', mssql.VarChar(10), shift);
      return r;
    };

    // weight basis (Q4/Q5)
    const wr = await ctx.app.request().query<{ basis: string; sack_tare_kg: number }>(
      `SELECT TOP 1 basis, sack_tare_kg FROM sms.weight_rule WHERE line_id=${line} ORDER BY effective_from DESC`,
    );
    const basis = wr.recordset[0]?.basis ?? 'as_recorded';
    const tare = Number(wr.recordset[0]?.sack_tare_kg ?? 0);

    const cones = (
      await req().query<{ n: number }>(
        `SELECT COUNT(*) n FROM sms.cone_event WHERE line_id=${line} AND shift_date=@d ${shiftClause}`,
      )
    ).recordset[0]!.n;
    const rejected = (
      await req().query<{ n: number }>(
        `SELECT COUNT(*) n FROM sms.reject_event WHERE line_id=${line} AND shift_date=@d ${shiftClause}`,
      )
    ).recordset[0]!.n;
    const sackAgg = (
      await req().query<{ n: number; kg: number; inr: number }>(
        `SELECT COUNT(*) n, ISNULL(SUM(weight_kg),0) kg, ISNULL(SUM(CASE WHEN in_range=1 THEN 1 ELSE 0 END),0) inr
         FROM sms.sack_event WHERE line_id=${line} AND shift_date=@d ${shiftClause}`,
      )
    ).recordset[0]!;

    let sackKg = Number(sackAgg.kg);
    if (basis === 'net') sackKg -= tare * sackAgg.n;

    console.log(`Production summary — line ${line}, ${date}${shift ? ', ' + shift : ' (all shifts)'}`);
    console.log('  ------------------------------------------');
    console.log(`  Total cones produced   ${String(cones).padStart(10)}`);
    console.log(`  Total rejected cones   ${String(rejected).padStart(10)}`);
    console.log(`  Total sacks produced   ${String(sackAgg.n).padStart(10)}`);
    console.log(`  Total sack weight (kg) ${sackKg.toFixed(1).padStart(10)}   [basis: ${basis}]`);
    if (sackAgg.n > 0) {
      const pct = ((100 * sackAgg.inr) / sackAgg.n).toFixed(1);
      console.log(`  Sacks in-range         ${(pct + '%').padStart(10)}`);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
