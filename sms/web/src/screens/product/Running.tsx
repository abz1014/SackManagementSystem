/**
 * Product › Running — the default tab. Two facts, moved and pivoted from
 * two different places (UX Phase 6 Brief 1, 16 Sep 2026):
 *
 *  (a) THE LINE-WIDE RECORDED PRODUCT, from `getProductAt(period.tsTo)` —
 *      the same call Line's ProductFooter makes — plus the rank>=2 "Change"
 *      form, moved VERBATIM in behaviour from the old product sheet component's
 *      `ChangeForm` (`setCurrentProduct`, POST /api/current-product). This
 *      is the FALLBACK answer, for readings from before the plant's own
 *      MaterialId column existed; the per-machine list below is primary.
 *
 *  (b) PRODUCTS IN FORCE NOW, pivoted from `getMachinesRunning(period.tsTo)`
 *      BY PRODUCT rather than by machine — a different question from Line's
 *      MachinesBlock ("is the line running, station by station"), which
 *      this deliberately does not rebuild. One row per product in force,
 *      listing the machines running it; each machine links to its station
 *      sheet and to Readings filtered to that station (the shared `st` key).
 *
 * `W.product.notSentToMachine` stays on screen: nothing built here, or
 * anywhere in SMS, reaches a machine — the selection is written to this
 * application's own database only.
 */
import { useMemo, useState } from 'react';
import { usePolling } from '../../lib/live';
import { W } from '../../lib/words';
import type { Period } from '../../lib/period';
import { Block, Chevron, Empty, Failed, SkelLines, rowKeys } from '../../ui/bits';
import { fmtClock, fmtDay, fmtDayLong, fmtG, fmtInt } from '../../lib/fmt';
import {
  getProductAt, getProducts, getCurrentProduct, getMachinesRunning, getStations, setCurrentProduct, stationLabel,
  type ProductOption, type TimelineEntry, type MachineRunning, type StationRow,
} from '../../api';
import { distinctProductLabels } from '../../lib/productLabel';

export function RunningTab({
  period,
  canWrite,
  onOpenStation,
  onSeeStationReadings,
}: {
  period: Period;
  canWrite: boolean;
  onOpenStation: (station: number) => void;
  onSeeStationReadings: (station: number) => void;
}) {
  const productAt = usePolling(() => getProductAt(period.tsTo), 30_000, `product-at:${period.tsTo}`);
  const products = usePolling(() => getProducts(), 5 * 60_000, 'products');
  const machines = usePolling(() => getMachinesRunning(period.tsTo), 30_000, `machines-running:${period.tsTo}`);
  const names = usePolling(() => getStations(), 10 * 60_000, 'stations');
  // Who set the running product and why. `getProductAt` (above) does not
  // carry `changedBy`/`reason` — it answers "what was in force at this
  // instant", not "who set it" — so this is a separate call, matched to the
  // period's own product by id (below) rather than shown unconditionally:
  // `getCurrentProduct` always answers for right now, and under a past
  // period or a replay that can be a different product than the one
  // `productAt` resolved.
  const current = usePolling(() => getCurrentProduct(), 30_000, 'current-product');
  const [nonce, setNonce] = useState(0);
  const onChanged = () => {
    setNonce((n) => n + 1);
    productAt.refresh();
    current.refresh();
  };
  void nonce;
  const setBy: TimelineEntry | null =
    current.data?.current && productAt.data?.product && current.data.current.productId === productAt.data.product.productId
      ? current.data.current
      : null;

  return (
    <>
      <Block label={W.product.title}>
        {productAt.error && !productAt.data ? (
          <Failed error={productAt.error} onRetry={productAt.refresh} />
        ) : products.error && !products.data ? (
          // UX Phase 7 Brief 1: `products.error` was never read here, so
          // /api/product-at succeeding while /api/products failed fell
          // through to the `!products.data` skeleton branch below FOREVER —
          // usePolling keeps retrying, but the same fetch keeps failing, and
          // nothing on screen ever told the reader that. `products` is also
          // needed by the change form (ChangeForm's own `products` prop), so
          // there is no partial render available here beyond retrying.
          <Failed error={products.error} onRetry={products.refresh} />
        ) : !productAt.data || !products.data ? (
          <SkelLines n={4} short />
        ) : (
          <LineWideProduct
            data={productAt.data}
            products={products.data.products}
            setBy={setBy}
            canWrite={canWrite}
            onChanged={onChanged}
          />
        )}
        <p className="mut sm" style={{ marginTop: 14 }}>{W.product.notSentToMachine}</p>
      </Block>

      <Block label={W.product.runningNow} note={W.product.runningNowNote}>
        {machines.error && !machines.data ? (
          <Failed error={machines.error} onRetry={machines.refresh} />
        ) : !machines.data ? (
          <SkelLines n={4} short />
        ) : (
          <ByProduct
            data={machines.data.data.machines}
            asOfUtc={machines.data.data.asOfUtc}
            names={names.data?.stations ?? []}
            products={products.data?.products ?? []}
            onOpenStation={onOpenStation}
            onSeeStationReadings={onSeeStationReadings}
          />
        )}
      </Block>
    </>
  );
}

/* ------------------------------------------------------------- line-wide */

function LineWideProduct({
  data,
  products,
  setBy,
  canWrite,
  onChanged,
}: {
  data: Awaited<ReturnType<typeof getProductAt>>;
  products: ProductOption[];
  /** Who recorded it and why — only when it agrees with `data.product`
   *  (see the file header on why this is not shown unconditionally). */
  setBy: TimelineEntry | null;
  canWrite: boolean;
  onChanged: () => void;
}) {
  return (
    <>
      {!data.product ? (
        <p className="mut">{data.neverRecorded ? W.product.none : W.product.noneAtThisTime}</p>
      ) : (
        <>
          <div className="headline">{data.product.label}</div>
          <dl className="kv" style={{ marginTop: 18 }}>
            <dt>{W.product.targetAndLimits}</dt>
            <dd>{data.limits?.label ?? '—'}</dd>
            <dt>{W.product.since}</dt>
            <dd>{fmtDayLong(data.product.effectiveFromUtc)}</dd>
            {setBy && (
              <>
                <dt>{W.product.setBy}</dt>
                <dd>{setBy.changedBy ?? '—'}{setBy.reason ? ` · ${setBy.reason}` : ''}</dd>
              </>
            )}
          </dl>
        </>
      )}
      {canWrite && (
        <ChangeForm products={products} currentId={data.product?.productId ?? null} onChanged={onChanged} />
      )}
    </>
  );
}

/** Moved verbatim in behaviour from the old product sheet component's `ChangeForm`. */
function ChangeForm({
  products,
  currentId,
  onChanged,
}: {
  products: ProductOption[];
  currentId: number | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn" style={{ marginTop: 18 }} onClick={() => setOpen(true)}>
        {W.product.change}
      </button>
    );
  }

  const chosen = typeof productId === 'number' ? products.find((p) => p.productId === productId) : undefined;
  const preview = chosen ? limitsLabel(chosen) : null;

  return (
    <form
      style={{ marginTop: 18, display: 'grid', gap: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (typeof productId !== 'number') return;
        setBusy(true);
        setFailed(false);
        try {
          await setCurrentProduct(productId, reason.trim() || undefined);
          setOpen(false);
          setReason('');
          setProductId('');
          onChanged();
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>{W.product.change}</span>
        <select
          value={productId}
          autoFocus
          onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">—</option>
          {products.map((p) => (
            <option key={p.productId} value={p.productId} disabled={p.productId === currentId}>
              {productLabel(p)}
              {p.color ? ` — ${p.color}` : ''}
              {p.activeFlag === false ? ' (inactive in product master)' : ''}
            </option>
          ))}
        </select>
      </label>
      {preview && <p className="mut sm">{W.product.previewLimits(preview)}</p>}
      {chosen?.activeFlag === false && <p className="acc sm">{W.product.inactive}</p>}
      <label className="field">
        <span>{W.product.reason}</span>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {failed && <p className="acc sm">{W.couldNotLoad}</p>}
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy || typeof productId !== 'number'}>
          {W.product.confirm}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>{W.product.cancel}</button>
      </div>
    </form>
  );
}

function productLabel(p: { description: string | null; lotCode: string | null; productId: number }): string {
  return p.description || p.lotCode || `Product ${p.productId}`;
}

function limitsLabel(p: ProductOption | undefined): string | null {
  if (!p || p.setpointG == null || p.weightOffsetMinusG == null || p.weightOffsetPlusG == null) return null;
  const minus = Math.abs(p.weightOffsetMinusG);
  const plus = Math.abs(p.weightOffsetPlusG);
  if (minus === plus) return `${fmtG(p.setpointG)} ± ${fmtG(plus)}`;
  return `${fmtG(p.setpointG - minus)} to ${fmtG(p.setpointG + plus)}`;
}

/* ------------------------------------------------------------- by product */

interface ProductGroup {
  materialId: number | null;
  productName: string | null;
  machines: MachineRunning[];
}

function groupByProduct(machines: MachineRunning[]): ProductGroup[] {
  const running = machines.filter((m) => !m.quiet);
  const order: string[] = [];
  const map = new Map<string, ProductGroup>();
  for (const m of running) {
    const key = m.materialId != null ? String(m.materialId) : `station:${m.station}`;
    let g = map.get(key);
    if (!g) {
      g = { materialId: m.materialId, productName: m.productName, machines: [] };
      map.set(key, g);
      order.push(key);
    }
    g.machines.push(m);
  }
  return order.map((k) => map.get(k)!);
}

function ByProduct({
  data,
  asOfUtc,
  names,
  products,
  onOpenStation,
  onSeeStationReadings,
}: {
  data: MachineRunning[];
  /** The instant the two-hour window ENDS — the newest reading on record,
   *  never the clock. Printed rather than implied: this pivot, like Line's
   *  own machine block, is not period-filtered, so its window can sit days
   *  away from whatever period the reader has selected (see words.ts
   *  `cone.machinesNote`). */
  asOfUtc: string | null;
  names: StationRow[];
  /** The product master, run through the one disambiguator — this pivot's
   *  entire purpose is grouping BY product, which the plain description
   *  from `machinesRunning` cannot do on its own: six PDAS materials on
   *  this line share the description "205-IL0-SD" (see productLabel.ts). */
  products: ProductOption[];
  onOpenStation: (station: number) => void;
  onSeeStationReadings: (station: number) => void;
}) {
  const groups = groupByProduct(data);
  if (groups.length === 0) return <Empty message={W.product.runningNowEmpty} />;
  const nameOf = new Map(names.map((n) => [n.stationId, n]));
  const labels = useMemo(() => distinctProductLabels(products), [products]);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {groups.map((g, i) => (
        <div key={g.materialId ?? `station-${i}`}>
          <p style={{ fontWeight: 500 }}>
            {(g.materialId != null ? labels.get(g.materialId) : null) ?? g.productName ?? (g.materialId != null ? W.cone.noProductName(g.materialId) : W.cone.noMaterial)}
          </p>
          <table style={{ marginTop: 6 }}>
            <tbody>
              {g.machines.map((m) => (
                <tr
                  key={m.station}
                  className="click"
                  tabIndex={0}
                  onClick={() => onOpenStation(m.station)}
                  onKeyDown={rowKeys(() => onOpenStation(m.station))}
                >
                  <td className="mut" style={{ width: '9em', whiteSpace: 'nowrap' }}>
                    {stationLabel(nameOf.get(m.station), m.station)}
                  </td>
                  <td>
                    <span className="mut">
                      {m.sinceIsWindowStart || m.sinceUtc == null ? W.cone.sinceAtLeast : W.cone.since(fmtClock(m.sinceUtc))}
                      {' · '}
                      {W.cone.conesInWindow(fmtInt(m.conesOnMaterial))}
                    </span>
                    <Chevron />
                  </td>
                  <td className="n">
                    <button
                      type="button"
                      className="linkish sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeeStationReadings(m.station);
                      }}
                    >
                      {W.nav.readings}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {asOfUtc && (
        <p className="mut sm">{W.cone.machinesWindow(`${fmtDay(asOfUtc)}, ${fmtClock(asOfUtc)}`)}</p>
      )}
    </div>
  );
}
