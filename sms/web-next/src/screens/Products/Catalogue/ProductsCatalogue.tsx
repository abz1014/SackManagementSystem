/**
 * Products & PDAS > Catalogue (task E9; board design/redesign-2026-10/mockups/PdasCatalogue.dc.html).
 *
 * "Which products and pallets does PDAS hold, and which stations run them now?" The writes here are PDAS
 * writes, so each is gated twice: absent below the engineer rank (WriteGate), and disabled while the
 * server says writes are off (`status.canWrite`; the server's reason is printed once, verbatim, in the
 * connection card the buttons point at). A write goes through a confirm step with a reason of at least ten
 * characters, shows nothing until the server answers, and a refusal is printed as the server worded it.
 * Retire-and-recreate is not an edit (CreateMaterial refuses a duplicate blend, count and tube whatever the
 * active flag says), and the screen says so.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getPallets, getProducts, setPalletActive, setProductActive, type PalletRow } from '../../../bridge/api';
import { fmt, pdasWords, productLabel } from '../../../bridge/lib';
import { C, REASON_MIN_CHARS, withFragments, FRAGMENTS } from '../../../copy';
import { useData, useMachinesRunning } from '../../../data';
import { ENGINEER_RANK } from '../../../ranks';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { DataTable, type Column } from '../../../ui/DataTable';
import { Disclosure } from '../../../ui/Disclosure';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { ReasonField, reasonValid } from '../../../ui/Field';
import { Segmented } from '../../../ui/Segmented';
import { Skeleton } from '../../../ui/Skeleton';
import { WriteGate } from '../../../ui/WriteGate';
import { routeFor } from '../../../ui/nav';
import type { ScreenProps } from '../../registry';
import { PdasStatusCard, usePdasWriteStatus } from '../PdasStatusCard';
import { ProductsTabs } from '../ProductsTabs';
import { activeFirst, buildRows, countByStatus, filterRows, type CatalogueFilter, type CatalogueRow } from './model';
import '../products.css';
import './catalogue.css';
const PC = withFragments(C.products, FRAGMENTS.productsParts);

const K = PC.catalogue;
const REASON_ID = 'pds-reason';

interface Target {
  kind: 'product' | 'pallet';
  id: number;
  what: string;
  /** The state the write asks for: true = reactivate, false = retire. */
  toActive: boolean;
}
interface Refusal {
  action: string;
  what: string;
  server: string;
}

export function ProductsCatalogueScreen({ route, rank, go }: ScreenProps) {
  const products = useData(K.productsPart, () => getProducts(), 'products:list', { live: false });
  const pallets = useData(K.palletsPart, () => getPallets(), 'products:pallets', { live: false });
  const machines = useMachinesRunning();
  const status = usePdasWriteStatus();

  const [filter, setFilter] = useState<CatalogueFilter>('active');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [shortReason, setShortReason] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const list = products.data ? products.data.products : null;
  const labels = useMemo(() => productLabel.distinctProductLabels(list ?? []), [list]);
  const machineList = machines.data ? machines.data.data.machines : null;
  const rows = useMemo(() => (list ? buildRows(list, labels, machineList) : null), [list, labels, machineList]);
  const linked = route.keys.pr ? Number(route.keys.pr) : null;

  const canWrite = status.data?.canWrite === true;
  const writeBlocked = !canWrite;

  const toChangeover = () => go(routeFor(route, { s: 'products', t: 'changeover' }));
  const toLimits = () => go(routeFor(route, { s: 'products', t: 'limits' }));

  const ask = (t: Target) => {
    setTarget(t);
    setReason('');
    setShortReason(false);
    setRefusal(null);
    setDone(null);
  };

  const confirm = async () => {
    if (!target) return;
    if (!reasonValid(reason)) {
      setShortReason(true);
      return;
    }
    setBusy(true);
    try {
      if (target.kind === 'product') await setProductActive(target.id, target.toActive, reason.trim());
      else await setPalletActive(target.id, target.toActive, reason.trim());
      setDone(target.toActive ? K.doneReactivated(target.what) : K.doneRetired(target.what));
      if (target.kind === 'product') products.refresh();
      else pallets.refresh();
    } catch (e) {
      setRefusal({ action: target.toActive ? K.reactivate : K.retire, what: target.what, server: (e as Error).message });
    } finally {
      setBusy(false);
      setTarget(null);
    }
  };

  const counts = rows ? countByStatus(rows) : null;
  const shown = rows ? activeFirst(filterRows(rows, filter, query)) : [];

  const act = (r: { kind: 'product' | 'pallet'; id: number; what: string; isRetired: boolean }) => (
    <WriteGate rank={rank} minRank={ENGINEER_RANK}>
      <button
        type="button"
        className="wr-btn pc-act"
        disabled={writeBlocked}
        aria-describedby={writeBlocked ? REASON_ID : undefined}
        onClick={() => ask({ kind: r.kind, id: r.id, what: r.what, toActive: r.isRetired })}
      >
        {r.isRetired ? K.reactivate : K.retire}
      </button>
    </WriteGate>
  );

  const columns: Column<CatalogueRow>[] = [
    {
      key: 'code',
      header: K.colCode,
      sortValue: (r) => r.code,
      render: (r) => <CodeCell row={r} linked={linked === r.id} />,
    },
    { key: 'colour', header: K.colColour, sortValue: (r) => r.colour ?? '', render: (r) => r.colour ?? K.dash },
    { key: 'count', header: K.colCount, render: (r) => r.count ?? K.dash },
    { key: 'tube', header: K.colTube, render: (r) => r.tube ?? K.dash },
    {
      key: 'target',
      header: K.colTarget,
      numeric: true,
      sortValue: (r) => r.setpointG,
      render: (r) => (r.setpointG == null ? K.dash : fmt.fmtG(r.setpointG)),
    },
    {
      key: 'tolerance',
      header: K.colTolerance,
      numeric: true,
      render: (r) =>
        r.plusG == null || r.minusG == null
          ? K.dash
          : r.plusG === r.minusG
            ? K.tolerance(fmt.fmtG(r.plusG))
            : K.toleranceSplit(fmt.fmtG(r.minusG), fmt.fmtG(r.plusG)),
    },
    {
      key: 'status',
      header: K.colStatus,
      sortValue: (r) => r.status,
      render: (r) => (
        <span className={`pc-badge${r.status === 'active' ? ' pc-badge--on' : ''}`}>
          {r.status === 'active' ? K.active : r.status === 'retired' ? K.retired : K.notStated}
        </span>
      ),
    },
    {
      key: 'running',
      header: K.colRunning,
      render: (r) => (r.stations === null ? K.unknown : r.stations.length === 0 ? K.none : r.stations.join(', ')),
    },
  ];
  if (rank >= ENGINEER_RANK) {
    columns.push({
      key: 'actions',
      header: K.colActions,
      render: (r) => act({ kind: 'product', id: r.id, what: r.label, isRetired: r.status === 'retired' }),
    });
  }

  const palletCols: Column<PalletRow>[] = [
    { key: 'pallet', header: K.colPallet, numeric: true, render: (p) => p.palletId },
    { key: 'used', header: K.colUsedFor, render: (p) => p.productLabel || K.noProductLabel(p.productId) },
    { key: 'pack', header: K.colPack, render: (p) => p.packSchemaLabel ?? K.dash },
    { key: 'lot', header: K.colLot, render: (p) => p.lot ?? K.dash },
    { key: 'colour', header: K.colSackColour, render: (p) => p.sackColour ?? K.dash },
    {
      key: 'status',
      header: K.colStatus,
      render: (p) => (
        <span className={`pc-badge${p.active !== false ? ' pc-badge--on' : ''}`}>
          {p.active === false ? K.retired : p.active === true ? K.active : K.notStated}
        </span>
      ),
    },
  ];
  if (rank >= ENGINEER_RANK) {
    palletCols.push({
      key: 'actions',
      header: K.colActions,
      render: (p) => act({ kind: 'pallet', id: p.palletId, what: K.pallet(p.palletId), isRetired: p.active === false }),
    });
  }

  return (
    <div className="pr-page">
      <ProductsTabs route={route} go={go} />
      <header className="pr-head">
        <div>
          <h1 className="pr-title">{K.title}</h1>
          {counts && (
            <p className="pr-sentence">
              <b>{counts.all === 0 ? K.headlineNone : K.headline(counts.active, counts.retired)}</b>
            </p>
          )}
          <p className="caption">{K.asked}</p>
        </div>
        <div className="pb-cta">
          <button type="button" className="ui-btn" onClick={toChangeover}>{K.newProduct}</button>
          <span className="caption">{K.newProductNote}</span>
        </div>
      </header>

      <PdasStatusCard status={status} reasonId={REASON_ID} compact />
      {status.status === 'error' && rank >= ENGINEER_RANK && <p className="pr-fail">{K.writeNoStatus}</p>}

      {refusal && (
        <div className="pc-refusal" role="alert">
          <p className="pc-refusal__title">{K.notChanged}</p>
          <p className="pc-refusal__line">{K.didNotRun(refusal.action, refusal.what)}</p>
          <p className="pc-refusal__line">
            {K.serverSaid} <span className="pc-refusal__server">{pdasWords.pdasReasonForDisplay(refusal.server)}</span>
          </p>
          <button type="button" className="ui-link" onClick={() => setRefusal(null)}>{K.dismiss}</button>
        </div>
      )}
      {done && (
        <p className="pr-fail" role="status">
          {done}{' '}
          <button type="button" className="ui-link" onClick={() => setDone(null)}>{K.dismiss}</button>
        </p>
      )}

      <section className="card pc-card" aria-labelledby="pc-products-title">
        <div className="pc-card__head">
          <h2 id="pc-products-title" className="pc-card__title">{K.productsTitle}</h2>
          <div className="pc-tools">
            {counts && (
              <Segmented
                label={K.filterLabel}
                value={filter}
                onChange={(id) => setFilter(id as CatalogueFilter)}
                options={[
                  { id: 'active', label: K.filterActive(counts.active) },
                  { id: 'retired', label: K.filterRetired(counts.retired) },
                  { id: 'all', label: K.filterAll(counts.all) },
                ]}
              />
            )}
            <div className="wr-field pc-search">
              <label className="wr-field__label" htmlFor="pc-search">{K.searchLabel}</label>
              <input
                id="pc-search"
                className="wr-input"
                type="search"
                value={query}
                placeholder={K.searchHint}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
        {machines.status === 'error' && (
          <p className="pr-fail" role="alert">
            {K.runningFailed}{' '}
            <button type="button" className="ui-link" onClick={machines.refresh}>{C.tryAgain}</button>
          </p>
        )}
        {products.status === 'loading' ? (
          <Skeleton part={K.productsPart} height={320} onRetry={products.refresh} />
        ) : products.status === 'error' || !rows ? (
          <ErrorState part={K.productsPart} cause={products.error ?? undefined} onRetry={products.refresh} />
        ) : (
          <DataTable
            columns={columns}
            rows={shown}
            rowKey={(r) => String(r.id)}
            caption={K.productsTitle}
            cardFields={6}
            empty={
              <EmptyState
                message={K.empty}
                action={query ? { label: K.emptyClear, onClick: () => setQuery('') } : undefined}
              />
            }
          />
        )}
        <p className="pr-note">{K.retiredNote}</p>
        <Disclosure id="catalogue-why" label={K.whyTitle}>
          <p>{K.whyBody}</p>
          <button type="button" className="ui-link" onClick={toLimits}>{K.whyLink}</button>
        </Disclosure>
      </section>

      <section className="card pc-card" aria-labelledby="pc-pallets-title">
        <h2 id="pc-pallets-title" className="pc-card__title">{K.palletsTitle}</h2>
        {pallets.status === 'loading' ? (
          <Skeleton part={K.palletsPart} height={200} onRetry={pallets.refresh} />
        ) : pallets.status === 'error' || !pallets.data ? (
          <ErrorState part={K.palletsPart} cause={pallets.error ?? undefined} onRetry={pallets.refresh} />
        ) : (
          <DataTable
            columns={palletCols}
            rows={[...pallets.data.pallets].sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.palletId - b.palletId)}
            rowKey={(p) => String(p.palletId)}
            caption={K.palletsTitle}
            cardFields={6}
            empty={<EmptyState message={K.palletsNone} />}
          />
        )}
      </section>

      <ConfirmDialog
        open={target !== null}
        title={target ? (target.toActive ? K.reactivateTitle(target.what) : K.retireTitle(target.what)) : ''}
        confirmLabel={target?.toActive ? K.reactivate : K.retire}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setTarget(null)}
      >
        {target && (
          <div className="pc-dialog">
            <p>
              {target.kind === 'product'
                ? target.toActive ? K.reactivateBodyProduct : K.retireBodyProduct
                : target.toActive ? K.reactivateBodyPallet : K.retireBodyPallet}
            </p>
            <ReasonField label={K.reasonLabel} value={reason} onChange={setReason} minLength={REASON_MIN_CHARS} hint={K.reasonHint} disabled={busy} />
            {shortReason && <p className="wr-field__error" role="alert">{K.reasonShort(REASON_MIN_CHARS)}</p>}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

function CodeCell({ row, linked }: { row: CatalogueRow; linked: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (linked) ref.current?.scrollIntoView?.({ block: 'center' });
  }, [linked]);
  return (
    <span ref={ref} className={`pc-code${linked ? ' pc-code--linked' : ''}`} aria-current={linked ? 'true' : undefined}>
      <b>{row.label}</b>
      <span className="pc-code__id">{K.id(row.id)}</span>
    </span>
  );
}
