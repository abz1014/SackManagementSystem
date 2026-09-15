/**
 * Management summary: the KPI set beside the period before, each with its
 * change, and the coverage of both periods stated first. Roadmap Phase 8
 * (15 Sep 2026). The verdict mark stays on the page head (Report.tsx).
 *
 * Every row prints "awaiting IFL's approval": the set and its definitions
 * (KPI-DEFINITIONS.md) are the developer's proposal until IFL signs them.
 */
import { W } from '../../lib/words';
import { Block, Empty } from '../../ui/bits';
import { fmtDayLong, fmtSpan } from '../../lib/fmt';
import type { KpiRow, ManagementSummaryData } from '../../api';
import { digitsFor, fmtDelta } from './model';

function fmtValue(v: number | null, unit: KpiRow['unit']): string {
  if (v == null) return '—';
  if (unit === 'seconds') return fmtSpan(v);
  const digits = digitsFor(unit);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit === '%' ? `${s}%` : `${s} ${unit}`;
}

export function SummarySection({ d }: { d: ManagementSummaryData }) {
  if (d.coverage.current.daysWithData === 0) {
    return (
      <Block first>
        <Empty message={W.nothingHere} />
      </Block>
    );
  }
  const priorEmpty = d.coverage.prior.daysWithData === 0;
  return (
    <>
      <Block first>
        <p className="g">
          {W.reports.priorSpan(fmtDayLong(d.prior.from), fmtDayLong(d.prior.to))}
          {' · '}
          {W.reports.priorCoverage(d.coverage.prior.daysWithData, d.coverage.prior.daysInPeriod)}.
        </p>
        {priorEmpty && <p className="mut sm" style={{ marginTop: 6 }}>{W.reports.priorNoData}</p>}
        <p className="mut sm" style={{ marginTop: 6 }}>{d.note}</p>
      </Block>

      <Block label={W.reports.kpi}>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{W.reports.kpi}</th>
                <th className="n">{W.reports.thisPeriod}</th>
                <th className="n">{W.reports.priorPeriod}</th>
                <th className="n">{W.reports.change}</th>
                <th>{W.reports.approval}</th>
              </tr>
            </thead>
            <tbody>
              {d.kpis.map((k) => (
                <tr key={k.key}>
                  <td>
                    {k.label}
                    {k.betterWhen !== 'neither' && (
                      <span className="mut sm"> · {k.betterWhen === 'higher' ? W.reports.betterHigher : W.reports.betterLower}</span>
                    )}
                  </td>
                  <td className="n">{fmtValue(k.current, k.unit)}</td>
                  <td className="n">{fmtValue(k.prior, k.unit)}</td>
                  <td className="n">{k.unit === 'seconds' && k.delta ? `${k.delta.abs > 0 ? '+' : k.delta.abs < 0 ? '−' : ''}${fmtSpan(Math.abs(k.delta.abs))}` : fmtDelta(k.delta, digitsFor(k.unit))}</td>
                  <td className="mut sm">{k.approval === 'awaiting' ? W.reports.approval : k.approval}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    </>
  );
}
