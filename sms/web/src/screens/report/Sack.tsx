/**
 * Sack report: count, kilograms, average, the scale's in-range share, cones
 * per sack (approximate, and labelled so), by shift, by day, by product, the
 * distribution, and the STOCK block. Roadmap Phase 8 (15 Sep 2026).
 *
 * The stock block is roadmap Phase 7's `/api/sacks/stock`, asked for
 * directly from here: until that route answers, the block says the ledger
 * has not started, and it never invents a figure. Stock is LINE-level by
 * Phase 7's own `basis`; per-machine stock is not computable from the data
 * IFL supplied (no machine column on the sack table at any layer), and the
 * block prints Phase 7's reason.
 */
import { useMemo } from 'react';
import { usePolling } from '../../lib/live';
import { W } from '../../lib/words';
import { distinctProductLabels } from '../../lib/productLabel';
import { Block, Empty, Failed, SkelLines } from '../../ui/bits';
import { fmtInt, fmtKg, fmtPct1 } from '../../lib/fmt';
import { getSackStock, type ProductOption, type SackReportData, type StockLedgerData } from '../../api';
import { fmtDayDmy, Fig, Histogram, LineTable } from './shared';

export function SackSection({ d, products }: { d: SackReportData; products: ProductOption[] }) {
  const t = d.totals;
  const labels = useMemo(() => distinctProductLabels(products), [products]);
  return (
    <>
      {t.sacks === 0 ? (
        <Block first>
          <Empty message={W.nothingHere} />
        </Block>
      ) : (
        <>
          <Block first>
            <div className="figs four">
              <Fig v={fmtInt(t.sacks)} u={W.reports.sacks} n={d.inRangePct != null ? W.reports.inRangeShare(fmtPct1(d.inRangePct)) : null} />
              <Fig v={fmtInt(Math.round(t.sackWeightKg))} u={W.reports.kg} n={t.avgSackKg != null ? `${fmtKg(t.avgSackKg)} ${W.report.averageSack}` : null} />
              <Fig v={d.conesPerSack == null ? '—' : String(d.conesPerSack)} u={W.reports.perSackApprox} n={null} />
              <Fig v={fmtInt(d.rejectedByScale)} u={W.reports.rejectedByScale.toLowerCase()} n={null} />
            </div>
            <p className="mut sm" style={{ marginTop: 14 }}>{d.caveats.time}</p>
            <p className="mut sm" style={{ marginTop: 6 }}>{d.caveats.machine}</p>
            <p className="mut sm" style={{ marginTop: 6 }}>{d.caveats.conesPerSack}</p>
          </Block>

          <Block>
            <div className="two-col">
              <div>
                <p className="h2"><span>{W.report.byShift}</span></p>
                <div className="tw"><LineTable rows={d.byShift} head={W.report.colShift} sackScale /></div>
              </div>
              <div>
                <p className="h2"><span>{W.report.byDay}</span></p>
                <div className="tw"><LineTable rows={d.byDay} head={W.report.colDay} sackScale /></div>
              </div>
            </div>
          </Block>

          {d.byProduct.length > 0 && (
            <Block label={W.reports.byProduct}>
              <div className="tw">
                <table className="ifl-table">
                  <thead>
                    <tr>
                      <th>{W.reports.colProduct}</th>
                      <th className="n">{W.report.colSacks}</th>
                      <th className="n">{W.report.colSackWeight}</th>
                      <th className="n">{W.report.averageSack}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byProduct.map((p) => (
                      <tr key={p.productId ?? 'none'}>
                        <td>{p.productId == null ? p.productLabel : (labels.get(p.productId) ?? p.productLabel)}</td>
                        <td className="n">{fmtInt(p.sacks)}</td>
                        <td className="n">{fmtInt(Math.round(p.sackWeightKg))} {W.fig.kg}</td>
                        <td className="n">{fmtKg(p.avgSackKg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Block>
          )}

          {d.distribution && (
            <Block label={W.reports.histogramKg(d.distribution.bucketSize)} note={`${fmtInt(d.distribution.implausible)} implausible excluded`}>
              <Histogram buckets={d.distribution.histogram} bucketSize={d.distribution.bucketSize} unit="" label={W.reports.histogramKg(d.distribution.bucketSize)} />
            </Block>
          )}
        </>
      )}

      <StockBlock from={d.period.from} to={d.period.to} />
    </>
  );
}

/** Roadmap Phase 7's ledger, for the period; "not started" until the route exists. */
function StockBlock({ from, to }: { from: string; to: string }) {
  const s = usePolling(() => getSackStock({ from, to }), 5 * 60_000, `report-stock:${from}:${to}`);
  // usePolling keeps the error as its message; the API's JSON 404 handler
  // answers `{ error: 'not found' }`, which is what an unmounted route says.
  const notStarted = s.error != null && /not found|HTTP 404/i.test(s.error);
  const led = s.data?.data;
  const cumulative = led != null && led.manualMovementRows === 0 && led.countedSinceDay != null;
  return (
    <Block
      label={cumulative ? W.reports.stockCumulative : W.reports.stock}
      note={cumulative ? W.reports.stockCumulativeBasis(fmtDayDmy(led.countedSinceDay!)) : W.reports.stockBasis}
    >
      {notStarted ? (
        <p className="mut">{W.reports.stockNotStarted}</p>
      ) : s.error && !s.data ? (
        <Failed error={s.error} onRetry={s.refresh} />
      ) : !s.data ? (
        <SkelLines n={4} />
      ) : (
        <Ledger d={s.data.data} />
      )}
    </Block>
  );
}

function Ledger({ d }: { d: StockLedgerData }) {
  if (!Array.isArray(d.days) || d.days.length === 0) return <p className="mut">{W.reports.stockNotAvailable}</p>;
  const n = (f: { sacks: number } | undefined) => fmtInt(f?.sacks ?? 0);
  return (
    <>
      <div className="tw">
        <table className="ifl-table">
          <thead>
            <tr>
              <th>{W.reports.colDay}</th>
              <th className="n">{W.reports.stockColOpening}</th>
              <th className="n">{W.reports.stockColReceipts}</th>
              <th className="n">{W.reports.stockColIssues}</th>
              <th className="n">{W.reports.stockColConsumption}</th>
              <th className="n">{W.reports.stockColAdjustments}</th>
              <th className="n">{W.reports.stockColClosing}</th>
            </tr>
          </thead>
          <tbody>
            {d.days.map((r) => (
              <tr key={r.day}>
                <td>{fmtDayDmy(r.day)}</td>
                <td className="n">{n(r.opening)}</td>
                <td className="n">{n(r.receipts)}</td>
                <td className="n">{n(r.issues)}</td>
                <td className="n">{n(r.consumption)}</td>
                <td className="n">{n(r.adjustments)}</td>
                <td className="n">{n(r.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.machineLevel && !d.machineLevel.enabled && <p className="mut sm" style={{ marginTop: 10 }}>{d.machineLevel.reason}</p>}
    </>
  );
}
