/**
 * Quality > Register > Sack stock (TRACE A3-047, A3-048, A3-050, A1-081..A1-084, A1-096, A4-14, G-3).
 *
 *  - The ledger is the LINE's stock, never per machine: the plant records no machine or station on a sack. The
 *    per-machine figure is present and says "not available" with the server's own reason.
 *  - Words for the columns, the types and the caveats are RESERVED (owner-reserved, GLOSSARY 3.6): they are read
 *    from RESERVED, never written here.
 *  - It is kept per production day (06:00 to 06:00): under a shift range it still covers whole days, and says so.
 *  - "Record a movement" is engineer rank and absent below it. NO OPTIMISTIC UI: the form stays open until the
 *    server says yes, the ledger is re-read, and a refusal is shown in the server's own words.
 */
import { useId, useState } from 'react';
import {
  MOVEMENT_TYPES,
  getProducts,
  getSackStock,
  recordSackMovement,
  type LedgerDay,
  type LedgerFlow,
  type MaterialLedger,
  type MovementType,
  type StockLedgerData,
} from '../../../bridge/api';
import { live, fmt, period as P } from '../../../bridge/lib';
import { REASON_MIN_CHARS, RESERVED, formatDate, C, FRAGMENTS, withFragments } from '../../../copy';
import { useData } from '../../../data';
import { ENGINEER_RANK } from '../../../ranks';
import type { Route } from '../../../route';
import { DataTable, type Column } from '../../../ui/DataTable';
import { Disclosure } from '../../../ui/Disclosure';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { NumberField, ReasonField, SelectField, reasonValid } from '../../../ui/Field';
import { Segmented } from '../../../ui/Segmented';
import { Sheet } from '../../../ui/Sheet';
import { Skeleton } from '../../../ui/Skeleton';
import { WriteGate } from '../../../ui/WriteGate';
import { intKey, periodSig, sheetFor } from './model';
const R = withFragments(C.register, FRAGMENTS.registerParts);
const RF = FRAGMENTS.register;

type Unit = 'sacks' | 'kg';
const unitOf = (v: string | undefined): Unit => (v === 'kg' ? 'kg' : 'sacks');

const kgText = (n: number): string => (n === 0 ? '0' : n.toLocaleString('en-US', { maximumFractionDigits: 1 }));
const flow = (f: LedgerFlow, u: Unit): string => (u === 'sacks' ? fmt.fmtInt(f.sacks) : kgText(f.kg));
const signed = (f: LedgerFlow, u: Unit): string => {
  const v = u === 'sacks' ? f.sacks : f.kg;
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${flow({ sacks: Math.abs(f.sacks), kg: Math.abs(f.kg) }, u)}`;
};
const unitWord = (n: number, u: Unit): string =>
  u === 'sacks' ? `${fmt.fmtInt(n)} ${RF.unitWordSacks}` : `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${RF.unitWordKg}`;

export interface StockLedgerProps {
  route: Route;
  rank: number;
  period: P.Period;
  go: (next: Route, opts?: { replace?: boolean }) => void;
}

export function StockLedger({ route, rank, period, go }: StockLedgerProps) {
  const unit = unitOf(route.keys.su);
  const product = intKey(route.keys.pr);
  const pq = P.periodQuery(period);
  const key = `${periodSig(period)}:${product ?? 'any'}`;
  const ledger = useData(
    RF.ledgerPart,
    () => getSackStock({ from: pq.from, to: pq.to, fromShift: pq.fromShift, toShift: pq.toShift, tsTo: pq.tsTo, product: product ?? undefined }),
    `register:stock:${key}`,
    { live: period.live },
  );
  const [recording, setRecording] = useState(false);
  const [done, setDone] = useState(false);
  const shiftNarrowed = !!(period.shift || period.fromShift || period.toShift);
  const d: StockLedgerData | null = ledger.data?.data ?? null;

  const setUnit = (u: string) => {
    const keys = { ...route.keys };
    if (u === 'kg') keys.su = 'kg';
    else delete keys.su;
    go({ ...route, keys }, { replace: true });
  };

  return (
    <section className="rg-stock" aria-label={RESERVED.sackLedger}>
      <div className="rg-stock__head">
        <h2 className="rg-h2">
          {RESERVED.sackLedger}
          <span className="rg-note"> {RESERVED.sackLedgerNote}</span>
        </h2>
        <div className="rg-stock__actions">
          <Segmented
            label={R.unitLabel}
            value={unit}
            onChange={setUnit}
            options={[
              { id: 'sacks', label: R.unitSacks },
              { id: 'kg', label: R.unitKg },
            ]}
          />
          <WriteGate rank={rank} minRank={ENGINEER_RANK}>
            <button type="button" className="ui-btn" onClick={() => { setDone(false); setRecording(true); }}>
              {R.record}
            </button>
          </WriteGate>
        </div>
      </div>
      {done && <p className="rg-ok" role="status">{R.recorded}</p>}
      {shiftNarrowed && <p className="rg-note">{R.wholeDays}</p>}

      {ledger.status === 'error' && !d ? (
        <ErrorState part={RF.ledgerPart} cause={ledger.error} onRetry={ledger.refresh} />
      ) : !d ? (
        <Skeleton part={RF.ledgerPart} height={220} onRetry={ledger.refresh} />
      ) : (
        <LedgerBody d={d} unit={unit} shiftNarrowed={shiftNarrowed} onOpenDay={(day) => go(sheetFor(route, 'stock', day))} />
      )}
      {ledger.staleError && <p className="rg-note" role="status">{RF.ledgerPart}: {ledger.staleError}</p>}

      {recording && rank >= ENGINEER_RANK && (
        <MovementSheet
          onClose={() => setRecording(false)}
          onRecorded={() => {
            setRecording(false);
            setDone(true);
            ledger.refresh();
          }}
        />
      )}
    </section>
  );
}

function LedgerBody({ d, unit, shiftNarrowed, onOpenDay }: { d: StockLedgerData; unit: Unit; shiftNarrowed: boolean; onOpenDay: (day: string) => void }) {
  const hasCounts = d.days.some((x) => x.openingEntries.sacks !== 0 || x.openingEntries.kg !== 0);
  const nothing = d.opening.sacks === 0 && d.closing.sacks === 0 && d.days.every((x) => x.movements === 0 && x.weighed.sacks === 0);

  const cols: Column<LedgerDay>[] = [
    { key: 'day', header: R.colDayStock, render: (r) => formatDate(`${r.day}T12:00:00Z`) },
    { key: 'opening', header: RESERVED.sackColOpening, numeric: true, render: (r) => flow(r.opening, unit) },
    ...(hasCounts ? [{ key: 'count', header: R.colCount, numeric: true, render: (r: LedgerDay) => signed(r.openingEntries, unit) }] : []),
    { key: 'receipts', header: RESERVED.sackColReceipts, numeric: true, render: (r) => flow(r.receipts, unit) },
    { key: 'issues', header: RESERVED.sackColIssues, numeric: true, render: (r) => flow(r.issues, unit) },
    { key: 'consumption', header: RESERVED.sackColConsumption, numeric: true, render: (r) => flow(r.consumption, unit) },
    { key: 'adjustments', header: RESERVED.sackColAdjustments, numeric: true, render: (r) => signed(r.adjustments, unit) },
    { key: 'closing', header: RESERVED.sackColClosing, numeric: true, render: (r) => <b>{flow(r.closing, unit)}</b> },
  ];
  const matCols: Column<MaterialLedger>[] = [
    { key: 'product', header: R.colProductStock, render: (m) => m.productName ?? (m.materialId === null ? R.noProduct : `Product ${m.materialId}`) },
    { key: 'opening', header: RESERVED.sackColOpening, numeric: true, render: (m) => flow(m.opening, unit) },
    { key: 'receipts', header: RESERVED.sackColReceipts, numeric: true, render: (m) => flow(m.receipts, unit) },
    { key: 'issues', header: RESERVED.sackColIssues, numeric: true, render: (m) => flow(m.issues, unit) },
    { key: 'consumption', header: RESERVED.sackColConsumption, numeric: true, render: (m) => flow(m.consumption, unit) },
    { key: 'adjustments', header: RESERVED.sackColAdjustments, numeric: true, render: (m) => signed(m.adjustments, unit) },
    { key: 'closing', header: RESERVED.sackColClosing, numeric: true, render: (m) => <b>{flow(m.closing, unit)}</b> },
  ];

  return (
    <>
      {nothing ? (
        <EmptyState message={R.ledgerEmpty} />
      ) : (
        <>
          <p className="rg-line">
            {(shiftNarrowed ? R.openingBeforeDays : R.openingBefore)(unitWord(unit === 'sacks' ? d.opening.sacks : d.opening.kg, unit))}{' '}
            {R.closingNow(unitWord(unit === 'sacks' ? d.closing.sacks : d.closing.kg, unit))}
          </p>
          <DataTable<LedgerDay>
            caption={RESERVED.sackLedger}
            columns={cols}
            rows={d.days}
            rowKey={(r) => r.day}
            onRowOpen={(r) => onOpenDay(r.day)}
            cardFields={4}
          />
          {unit === 'kg' && d.kgMissing > 0 && <p className="rg-note">{R.kgShort(d.kgMissing)}</p>}
          {d.byMaterial.length > 1 && (
            <Disclosure id="register-stock-by-product" label={R.byProduct}>
              <DataTable<MaterialLedger>
                caption={R.byProduct}
                columns={matCols}
                rows={d.byMaterial}
                rowKey={(m) => String(m.materialId ?? 'none')}
              />
            </Disclosure>
          )}
        </>
      )}
      {/* Present, and saying "not available" with the server's reason: a reader who looks for it finds why, never a blank. */}
      <p className="rg-line">
        <span className="rg-note">{RESERVED.sackPerMachine}</span> <b>{RESERVED.sackPerMachineNone}</b>
        <span className="rg-note">. {d.machineLevel.reason}</span>
      </p>
      <p className="rg-note rg-note--wide">{RESERVED.sackLedgerCaveat}</p>
    </>
  );
}

/* ------------------------------------------------------------ the form */

const plantLocal = (iso: string | null | undefined): string => (iso ? iso.slice(0, 16) : '');

function MovementSheet({ onClose, onRecorded }: { onClose: () => void; onRecorded: () => void }) {
  const { line } = live.useLive();
  const plantNow = plantLocal(line?.plantNowUtc);
  const products = useData(R.fProduct, () => getProducts(), 'products', { live: false });
  const [type, setType] = useState<MovementType>('issue');
  const [sacks, setSacks] = useState('');
  const [kg, setKg] = useState('');
  const [product, setProduct] = useState('');
  const [when, setWhen] = useState(plantNow);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whenId = useId();

  const n = Number(sacks);
  const sacksOk = sacks.trim() !== '' && Number.isInteger(n);
  const whenOk = when.trim() !== '';
  const whyOk = type !== 'adjustment' || reasonValid(why);
  const valid = sacksOk && whenOk && whyOk;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const k = kg.trim() === '' ? null : Number(kg);
      await recordSackMovement({
        movementType: type,
        quantitySacks: n,
        quantityKg: k !== null && Number.isFinite(k) ? k : null,
        materialId: product === '' ? null : Number(product),
        occurredAtPlant: when,
        reason: why.trim() === '' ? null : why.trim(),
      });
      onRecorded();
    } catch (e) {
      const detail = (e as { detail?: string | null }).detail;
      setError(detail ?? (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const list = products.data?.products ?? [];
  return (
    <Sheet
      open
      onClose={onClose}
      title={R.formTitle}
      footer={
        <div className="rg-form__actions">
          <button type="button" className="ui-btn" disabled={busy || !valid} onClick={() => void save()}>
            {busy ? R.fSaving : R.fSave}
          </button>
          <button type="button" className="ui-link" onClick={onClose}>{R.fCancel}</button>
        </div>
      }
    >
      <form className="rg-form" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void save(); }}>
        <SelectField
          label={R.fType}
          value={type}
          onChange={(v) => setType(v as MovementType)}
          options={MOVEMENT_TYPES.map((t) => ({ value: t, label: RESERVED.sackTypeName[t] }))}
        />
        <NumberField label={R.fSacks} value={sacks} onChange={setSacks} step={1} error={sacks.trim() !== '' && !sacksOk ? R.sacksInvalid : undefined} />
        <NumberField label={R.fKg} value={kg} onChange={setKg} step={0.001} unit="kg" />
        <SelectField
          label={R.fProduct}
          value={product}
          onChange={setProduct}
          placeholder={R.fAnyProduct}
          options={list.map((p) => ({ value: String(p.productId), label: p.description ?? p.lotCode ?? `Product ${p.productId}` }))}
          hint={products.status === 'error' ? R.productListUnavailable : undefined}
        />
        <div className="wr-field">
          <label className="wr-field__label" htmlFor={whenId}>{R.fWhen}</label>
          <input id={whenId} className="wr-input" type="datetime-local" value={when} max={plantNow || undefined} onChange={(e) => setWhen(e.target.value)} />
          {!whenOk && <div className="wr-field__error" role="alert">{R.whenInvalid}</div>}
        </div>
        <ReasonField
          label={R.fWhy}
          value={why}
          onChange={setWhy}
          minLength={type === 'adjustment' ? REASON_MIN_CHARS : 0}
          hint={type === 'adjustment' ? R.fWhyHint : undefined}
        />
        <p className="rg-note">{R.recordNote}</p>
        {error && <p className="rg-error" role="alert">{R.saveFailed} {error}</p>}
      </form>
    </Sheet>
  );
}
