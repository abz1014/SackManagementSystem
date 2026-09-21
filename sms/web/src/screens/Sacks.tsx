/**
 * Sacks — "How many sacks were weighed, how heavy, how many the scale passed,
 * and what is in line stock." Roadmap Phase 7 (15 Sep 2026): the sack half
 * of requirement 6 and the LINE-level half of requirement 7.
 *
 * Four blocks, in the order a manager reads them: the period's figures (the
 * in-range share the CLI computed and no screen showed), the same by shift
 * and by product, the stock ledger with the form that adds a movement to it,
 * and the sack history — the register's own sack listing, reused, not
 * re-implemented (Readings keeps its Sacks toggle; this is the same rows in
 * a second place because the ledger is read beside them).
 *
 * THREE FACTS THE DATA FORCES, printed once, as the ledger's footnote:
 *  - a sack's time is when the plant wrote the reading (DQ-5), so the list
 *    says "Recorded" and the sheet explains;
 *  - no sack is attributed to a machine, because the source records none and
 *    this system does not infer one from the cones weighed around it
 *    (roadmap rule 6). The "Per machine" figure reads "not available" with
 *    the server's reason beside it, rather than being absent;
 *  - cones per sack is an approximation, labelled.
 * What a "receipt" is and which unit the ledger is kept in are the
 * developer's reading until IFL confirms; the footnote says so.
 *
 * Nothing about the balance is worked out here: every figure is the server's
 * (services/sackStock.ts), and the screen only chooses the unit to show.
 */
import { useState } from 'react';
import { useLive, usePolling, usePlantNow, LIST_POLL_MS } from '../lib/live';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import { Block, Details, Empty, Failed, Figures, SkelFigures, SkelLines, Toggle, Toolbar } from '../ui/bits';
import { fmtClock, fmtDayLong, fmtInt, fmtKg, fmtPct1, fmtSpan } from '../lib/fmt';
import { assessHealth } from '../lib/health';
import { Pager, PAGE_SIZE, ReadingTable } from './Readings';
import {
  getEvents, getProducts, getSackStock, getSackSummary, recordSackMovement, MOVEMENT_TYPES,
  type LedgerDay, type LedgerFlow, type MovementType, type ProductOption, type RegisterType, type SackSummaryData,
  type StockLedgerData,
} from '../api';

/** Roadmap Phase 2b (16 Sep 2026): the ledger's unit, in the URL as `su`. */
export type SackUnit = 'sacks' | 'kg';

const periodLabel = (p: Period): string =>
  p.from === p.to ? fmtDayLong(p.from) : `${fmtDayLong(p.from)} to ${fmtDayLong(p.to)}`;

export function SacksScreen({
  period,
  unit,
  onUnitChange,
  page,
  onPageChange,
  canRecord,
  onOpenReading,
  onOpenDay,
}: {
  period: Period;
  unit: SackUnit;
  onUnitChange: (u: SackUnit) => void;
  /** The history register's page — see `History` below. */
  page: number;
  onPageChange: (p: number) => void;
  /** Rank 3 — the developer's default until IFL sets the rank for a stock entry. */
  canRecord: boolean;
  onOpenReading: (type: RegisterType, id: string | number) => void;
  /** The stock sheet for one production day. */
  onOpenDay: (day: string) => void;
}) {
  const slow = period.live ? 60_000 : 10 * 60_000;
  const key = `${period.from}:${period.to}:${period.shift ?? 'all'}:${period.tsTo}`;
  const summary = usePolling(
    () => getSackSummary({ from: period.from, to: period.to, shift: period.shift, tsTo: period.tsTo }),
    slow,
    `sacks:summary:${key}`,
  );
  const ledger = usePolling(() => getSackStock({ from: period.from, to: period.to, tsTo: period.tsTo }), slow, `sacks:stock:${key}`);

  const s = summary.data?.data ?? null;
  const headline = !s
    ? null
    : s.totals.sacks === 0
      ? W.sacks.headlineNone(periodLabel(period))
      : W.sacks.headline(periodLabel(period), fmtInt(s.totals.sacks), fmtInt(Math.round(s.totals.kg)), s.totals.inRangePct == null ? null : fmtPct1(s.totals.inRangePct));

  return (
    <>
      <div className="page">
        <p className="q">{W.sacks.question}</p>
        {headline ? <h1 className="wide">{headline}</h1> : <div className="skel line" style={{ height: 'var(--fs-head)', maxWidth: '40ch' }} />}
      </div>

      <Block first>
        {summary.error && !s ? (
          <Failed error={summary.error} onRetry={summary.refresh} />
        ) : !s ? (
          <SkelFigures n={4} />
        ) : (
          <SummaryFigures s={s} />
        )}
      </Block>

      {s && s.totals.sacks > 0 && (
        <Block>
          <div className="two-col">
            <div>
              <p className="h2"><span>{W.sacks.byShift}</span></p>
              <div className="tw"><GroupTable head={W.sacks.colShift} rows={s.byShift.map((r) => ({ label: W.shiftName[r.shift as 'morning'] ?? r.shift, ...r }))} /></div>
            </div>
            <div>
              <p className="h2"><span>{W.sacks.byProduct}</span></p>
              <div className="tw"><GroupTable head={W.sacks.colProduct} rows={s.byProduct.map((r) => ({ label: r.productName ?? (r.materialId == null ? W.sacks.noProduct : `Product ${r.materialId}`), ...r }))} /></div>
              {s.unattributed.rows > 0 && (
                <p className="mut sm" style={{ marginTop: 8 }}>{W.sacks.unattributed(fmtInt(s.unattributed.rows), fmtInt(s.unattributed.of))}</p>
              )}
            </div>
          </div>
        </Block>
      )}

      <Block label={W.sacks.ledger} note={W.sacks.ledgerNote}>
        {ledger.error && !ledger.data ? (
          <Failed error={ledger.error} onRetry={ledger.refresh} />
        ) : !ledger.data ? (
          <SkelLines n={6} />
        ) : (
          <Ledger
            d={ledger.data.data}
            unit={unit}
            onUnit={onUnitChange}
            canRecord={canRecord}
            onRecorded={() => { ledger.refresh(); summary.refresh(); }}
            onOpenDay={onOpenDay}
          />
        )}
      </Block>

      <History period={period} page={page} onPageChange={onPageChange} onOpenReading={onOpenReading} />
    </>
  );
}

/* ---------------------------------------------------------------- figures */

function SummaryFigures({ s }: { s: SackSummaryData }) {
  const t = s.totals;
  if (t.sacks === 0) return <Empty message={W.readings.nothing} />;
  return (
    <Figures
      items={[
        { value: fmtInt(t.sacks), unit: W.sacks.figSacks },
        {
          value: fmtInt(Math.round(t.kg)),
          unit: W.sacks.figKg,
          note: t.avgKg == null ? null : (
            <>
              {W.sacks.avgNote(fmtKg(t.avgKg))}
              {t.implausible > 0 && <> · {W.sacks.avgExcluded(fmtInt(t.implausible))}</>}
            </>
          ),
        },
        {
          value: t.inRangePct == null ? '—' : fmtPct1(t.inRangePct),
          unit: W.sacks.figInRange,
          note: (
            <>
              {W.sacks.inRangeNote(fmtInt(t.inRange), fmtInt(t.sacks - t.noFlag))}
              {t.noFlag > 0 && <> · {W.sacks.noFlagNote(fmtInt(t.noFlag))}</>}
            </>
          ),
        },
        { value: t.conesPerSack == null ? '—' : String(t.conesPerSack), unit: W.sacks.figConesPerSack, note: W.sacks.conesPerSackNote },
      ]}
    />
  );
}

function GroupTable({
  head,
  rows,
}: {
  head: string;
  rows: { label: string; sacks: number; kg: number; avgKg: number | null; inRangePct: number | null }[];
}) {
  if (rows.length === 0) return <Empty message={W.nothingHere} />;
  return (
    <table>
      <thead>
        <tr>
          <th>{head}</th>
          <th className="n">{W.sacks.colSacks}</th>
          <th className="n">{W.sacks.colKg}</th>
          <th className="n">{W.sacks.colAvg}</th>
          <th className="n">{W.sacks.colInRange}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td className="n">{fmtInt(r.sacks)}</td>
            <td className="n">{fmtInt(Math.round(r.kg))}</td>
            <td className="n">{r.avgKg == null ? '—' : fmtKg(r.avgKg)}</td>
            <td className="n">{r.inRangePct == null ? '—' : fmtPct1(r.inRangePct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ----------------------------------------------------------------- ledger */

const flow = (f: LedgerFlow, unit: SackUnit): string =>
  unit === 'sacks' ? fmtInt(f.sacks) : f.kg === 0 ? '0' : f.kg.toLocaleString('en-US', { maximumFractionDigits: 1 });
const signed = (f: LedgerFlow, unit: SackUnit): string => {
  const v = unit === 'sacks' ? f.sacks : f.kg;
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${flow({ sacks: Math.abs(f.sacks), kg: Math.abs(f.kg) }, unit)}`;
};
const unitWord = (n: number, unit: SackUnit): string => (unit === 'sacks' ? `${fmtInt(n)} ${W.sacks.figSacks}` : `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${W.sacks.figKg}`);

function Ledger({
  d,
  unit,
  onUnit,
  canRecord,
  onRecorded,
  onOpenDay,
}: {
  d: StockLedgerData;
  unit: SackUnit;
  onUnit: (u: SackUnit) => void;
  canRecord: boolean;
  onRecorded: () => void;
  onOpenDay: (day: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const hasCounts = d.days.some((x) => x.openingEntries.sacks !== 0 || x.openingEntries.kg !== 0);
  const nothing = d.opening.sacks === 0 && d.closing.sacks === 0 && d.days.every((x) => x.movements === 0 && x.weighed.sacks === 0);

  return (
    <>
      <Toolbar
        left={<Toggle label="Unit" value={unit} onChange={onUnit} options={[{ key: 'sacks', label: W.sacks.unit.sacks }, { key: 'kg', label: W.sacks.unit.kg }]} />}
        right={canRecord && !recording ? (
          <button type="button" className="btn" onClick={() => setRecording(true)}>{W.sacks.record}</button>
        ) : null}
      />

      {recording && (
        <MovementForm
          onDone={() => { setRecording(false); onRecorded(); }}
          onCancel={() => setRecording(false)}
        />
      )}

      {nothing ? (
        <p className="state">{W.sacks.ledgerEmpty}</p>
      ) : (
        <>
          <p style={{ marginTop: 14 }}>
            {W.sacks.openingBefore(unitWord(unit === 'sacks' ? d.opening.sacks : d.opening.kg, unit))}{' '}
            {W.sacks.closingNow(unitWord(unit === 'sacks' ? d.closing.sacks : d.closing.kg, unit))}
          </p>
          <div className="tw" style={{ marginTop: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>{W.sacks.colDay}</th>
                  <th className="n">{W.sacks.colOpening}</th>
                  {hasCounts && <th className="n">{W.sacks.colCount}</th>}
                  <th className="n">{W.sacks.colReceipts}</th>
                  <th className="n">{W.sacks.colIssues}</th>
                  <th className="n">{W.sacks.colConsumption}</th>
                  <th className="n">{W.sacks.colAdjustments}</th>
                  <th className="n">{W.sacks.colClosing}</th>
                </tr>
              </thead>
              <tbody>
                {d.days.map((day) => (
                  <DayRow key={day.day} day={day} unit={unit} hasCounts={hasCounts} onOpen={() => onOpenDay(day.day)} />
                ))}
              </tbody>
            </table>
          </div>
          {unit === 'kg' && d.kgMissing > 0 && <p className="mut sm" style={{ marginTop: 8 }}>{W.sacks.kgIncomplete(d.kgMissing)}</p>}
          {d.byMaterial.length > 1 && (
            <Details summary={W.sacks.byProduct}>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>{W.sacks.colProduct}</th>
                      <th className="n">{W.sacks.colOpening}</th>
                      <th className="n">{W.sacks.colReceipts}</th>
                      <th className="n">{W.sacks.colIssues}</th>
                      <th className="n">{W.sacks.colConsumption}</th>
                      <th className="n">{W.sacks.colAdjustments}</th>
                      <th className="n">{W.sacks.colClosing}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byMaterial.map((m) => (
                      <tr key={m.materialId ?? 'none'}>
                        <td className={m.materialId == null ? 'mut' : ''}>{m.productName ?? (m.materialId == null ? W.sacks.noProduct : `Product ${m.materialId}`)}</td>
                        <td className="n">{flow(m.opening, unit)}</td>
                        <td className="n">{flow(m.receipts, unit)}</td>
                        <td className="n">{flow(m.issues, unit)}</td>
                        <td className="n">{flow(m.consumption, unit)}</td>
                        <td className="n">{signed(m.adjustments, unit)}</td>
                        <td className="n"><b>{flow(m.closing, unit)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Details>
          )}
        </>
      )}

      {/* The per-machine figure is present and says "not available", with
          the server's reason: a GM who looks for it must find why, never a
          blank. */}
      <p style={{ marginTop: 18 }}>
        <span className="mut">{W.sacks.perMachine}</span> <b>{W.sacks.perMachineNone}</b>
        <span className="mut sm"> — {d.machineLevel.reason}</span>
      </p>
      <p className="mut sm" style={{ marginTop: 10, maxWidth: '90ch' }}>{W.sacks.ledgerCaveat}</p>
    </>
  );
}

function DayRow({ day, unit, hasCounts, onOpen }: { day: LedgerDay; unit: SackUnit; hasCounts: boolean; onOpen: () => void }) {
  const quiet = day.movements === 0 && day.weighed.sacks === 0;
  return (
    <tr className={`click${quiet ? ' mut' : ''}`} tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <td>{fmtDayLong(day.day)}</td>
      <td className="n">{flow(day.opening, unit)}</td>
      {hasCounts && <td className="n">{signed(day.openingEntries, unit)}</td>}
      <td className="n">{flow(day.receipts, unit)}</td>
      <td className="n">{flow(day.issues, unit)}</td>
      <td className="n">{flow(day.consumption, unit)}</td>
      <td className="n">{signed(day.adjustments, unit)}</td>
      <td className="n"><b>{flow(day.closing, unit)}</b></td>
    </tr>
  );
}

/* ------------------------------------------------------------ the form */

/** "YYYY-MM-DDTHH:MM" on the plant's clock, for a datetime-local input's default. */
const plantLocal = (iso: string | null): string => (iso ? iso.slice(0, 16) : '');

function MovementForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const plantNow = usePlantNow();
  const products = usePolling(() => getProducts(), 10 * 60_000, 'products');
  const [type, setType] = useState<MovementType>('issue');
  const [sacks, setSacks] = useState('');
  const [kg, setKg] = useState('');
  const [product, setProduct] = useState('');
  const [when, setWhen] = useState(() => plantLocal(plantNow));
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list: ProductOption[] = products.data?.products ?? [];

  return (
    <form
      style={{ marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'end' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const n = Number(sacks);
          const k = kg.trim() === '' ? null : Number(kg);
          await recordSackMovement({
            movementType: type,
            quantitySacks: Number.isFinite(n) ? n : 0,
            quantityKg: k != null && Number.isFinite(k) ? k : null,
            materialId: product === '' ? null : Number(product),
            occurredAtPlant: when || plantLocal(plantNow),
            reason: why.trim() || null,
          });
          onDone();
        } catch (err) {
          const detail = (err as { detail?: string | null }).detail;
          setError(detail ?? String((err as Error).message ?? err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>{W.sacks.type}</span>
        <select value={type} onChange={(e) => setType(e.target.value as MovementType)}>
          {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{W.sacks.typeName[t]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{W.sacks.quantity}</span>
        <input type="number" step="1" required value={sacks} autoFocus onChange={(e) => setSacks(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.sacks.quantityKg}</span>
        <input type="number" step="0.001" value={kg} onChange={(e) => setKg(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.sacks.product}</span>
        <select value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">{W.sacks.anyProduct}</option>
          {list.map((p) => (
            <option key={p.productId} value={p.productId}>{p.description ?? p.lotCode ?? `Product ${p.productId}`}</option>
          ))}
        </select>
        {/* UX Phase 7 Brief 1: `list` silently degrading to [] on a failed
            /api/products used to be indistinguishable from a genuinely empty
            product master — the dropdown just offered fewer options. */}
        {products.error && !products.data && (
          <span className="mut sm">{W.sacks.productListUnavailable}</span>
        )}
      </label>
      <label className="field">
        <span>{W.sacks.when}</span>
        <input type="datetime-local" required value={when} max={plantLocal(plantNow)} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <label className="field" style={{ gridColumn: '1 / -1' }}>
        <span>{W.sacks.why}</span>
        <input type="text" maxLength={255} required={type === 'adjustment'} value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <div className="row" style={{ gridColumn: '1 / -1' }}>
        <button type="submit" className="btn primary" disabled={busy}>{W.sacks.save}</button>
        <button type="button" className="btn" onClick={onCancel}>{W.sacks.cancel}</button>
        <span className="mut sm">{W.sacks.recordNote}</span>
      </div>
      {error && (
        <p className="acc sm" role="alert" style={{ gridColumn: '1 / -1' }}>{W.sacks.saveFailed} {error}</p>
      )}
    </form>
  );
}

/* ---------------------------------------------------------------- history */

function History({
  period,
  page,
  onPageChange,
  onOpenReading,
}: {
  period: Period;
  /** Roadmap Phase 2b (16 Sep 2026): lifted to the URL (`sp`), so this
   *  register's page survives a refresh or a pasted link like the rest. */
  page: number;
  onPageChange: (p: number) => void;
  onOpenReading: (type: RegisterType, id: string | number) => void;
}) {
  const { line } = useLive();
  const health = assessHealth(line);
  const stale = health.kind !== 'ok';
  const rows = usePolling(
    () => getEvents({
      type: 'sack', from: period.from, to: period.to, shift: period.shift, tsFrom: period.tsFrom, tsTo: period.tsTo,
      page, pageSize: PAGE_SIZE, sort: 'time', dir: 'desc',
    }),
    period.live ? LIST_POLL_MS : 5 * 60_000,
    `sacks:history:${period.from}:${period.to}:${period.shift ?? 'all'}:${page}`,
  );
  const total = rows.data?.data.total ?? 0;
  const lagText =
    health.kind === 'stale'
      ? W.lag.stale(health.readingUtc ? fmtClock(health.readingUtc) : '—')
      : health.kind === 'late'
        ? W.lag.late(fmtSpan(health.lagSeconds))
        : W.lag.noData;

  return (
    <Block label={W.sacks.history} note={rows.data ? W.sacks.historyNote(fmtInt(total)) : null}>
      {rows.error && !rows.data ? (
        <Failed error={rows.error} onRetry={rows.refresh} />
      ) : rows.loading && !rows.data ? (
        <SkelLines n={8} />
      ) : total === 0 ? (
        <Empty message={W.readings.nothing} />
      ) : (
        <>
          <div className="tw">
            <ReadingTable rows={rows.data?.data.rows ?? []} listing="sacks" onOpen={onOpenReading} />
          </div>
          <p className="row between mut sm" style={{ marginTop: 14 }}>
            <span>
              {period.live && <span className={`dot live${stale ? ' bad' : ''}`} aria-hidden="true" />}
              {stale ? lagText : period.live ? W.readings.liveNote : null}
            </span>
            <span>
              {W.readings.perPage(PAGE_SIZE, fmtInt(total))}
              <Pager page={page} total={total} onPage={onPageChange} />
            </span>
          </p>
        </>
      )}
    </Block>
  );
}
