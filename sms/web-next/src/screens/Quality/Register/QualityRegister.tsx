/**
 * Quality > Register (task E8). TRACE A3-051..A3-055, A1-043, A1-045, A2-019, A2-020, A4-17, A6-07..A6-10, G-26, G-7.
 *
 * What this screen answers: what was weighed, and which readings failed a check?
 *
 *  - ONE STATUS VOCABULARY. The scale's check (passed / failed weight check) and the product's limits (within /
 *    under / over) are two named facts. "Inspection fails" are a different table from "Weight-check fails"; neither
 *    is ever called a bare "rejected".
 *  - A COUNT THAT HAS NOT ARRIVED IS NEVER ZERO. The headline's two counts come from two requests; the combined
 *    "N weighed, M failed" sentence needs both. A failed fetch names its part.
 *  - THE URL IS THE STATE. rl listing, rf hop filter, rcs check results, rp pages shown, st station, pr product.
 *    The hops from Today, Weight, Rejects and Stations land here by those keys.
 *  - Export CSV is manager rank and absent below it; Print is for everyone and waits until the rows have loaded.
 *  - Print layout is keyed to the stable `.rg` class (decision E-6), not to any translatable label.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  eventsExportUrl,
  getEvents,
  getProducts,
  getStations,
  type ConeState,
  type RegisterPage,
  type RegisterRow,
  CONE_STATES,
} from '../../../bridge/api';
import { live, period as P } from '../../../bridge/lib';
import { RegisterPrintHead } from '../../../bridge/register';
import { RESERVED, formatClock, formatDate, C, FRAGMENTS, withFragments } from '../../../copy';
import { useData } from '../../../data';
import { usePeriod } from '../../../data/usePeriod';
import { EXPORT_MIN_RANK } from '../../../ranks';
import { Chip } from '../../../ui/Chip';
import { DataTable, type Column } from '../../../ui/DataTable';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { SelectField } from '../../../ui/Field';
import { Skeleton } from '../../../ui/Skeleton';
import { Tabs } from '../../../ui/Tabs';
import { WriteGate } from '../../../ui/WriteGate';
import type { ScreenProps } from '../../registry';
import { QualityTabs } from '../QualityTabs';
import { reasonName } from '../Rejects/format';
import { StockLedger } from './StockLedger';
import {
  LISTINGS,
  MAX_PAGES,
  PAGE_SIZE,
  buildQuery,
  coneVerdict,
  countLine,
  countStateOf,
  intKey,
  matchesSearch,
  parseFilter,
  parseListing,
  parsePages,
  parseStates,
  periodSig,
  periodWords,
  rowType,
  sheetFor,
  withKey,
  withListing,
  withPages,
  withoutHop,
  type Listing,
} from './model';
import './register.css';
const R = withFragments(C.register, FRAGMENTS.registerParts);
const RF = FRAGMENTS.register;

/** A request that never settles: the part stays loading until its inputs exist, with no request and no error. */
const wait = (): Promise<never> => new Promise<never>(() => {});

interface Loaded {
  rows: RegisterRow[];
  total: number;
  page: RegisterPage;
}

export function QualityRegisterScreen(props: ScreenProps) {
  return (
    <>
      <QualityTabs route={props.route} go={props.go} />
      <RegisterBody {...props} />
    </>
  );
}

function RegisterBody({ route, rank, go }: ScreenProps) {
  const { period, status: periodStatus, failed: periodFailed } = usePeriod();
  const { line, asOf } = live.useLive();

  const keys = route.keys;
  const listing = parseListing(keys);
  const hop = parseFilter(keys);
  const outsideOnly = hop === 'outsideLimits';
  const states = parseStates(keys);
  const station = intKey(keys.st);
  const product = intKey(keys.pr);
  const pages = parsePages(keys);
  const [search, setSearch] = useState('');
  const [batch, setBatch] = useState('auto');

  // A closed period can still be re-read now and then, but only a live one can gain rows while it is open.
  const sig = period ? periodSig(period) : 'wait';
  useEffect(() => setBatch('auto'), [sig]);

  // Narrowing the period while parked on a later page used to leave a header count over an empty table (H12):
  // fall back to the first page, as a replace (a correction, not a choice). Not on first mount, so a deep link keeps its pages.
  const seenSig = useRef<string | null>(null);
  useEffect(() => {
    if (!period) return;
    if (seenSig.current === null || seenSig.current === sig) {
      seenSig.current = sig;
      return;
    }
    seenSig.current = sig;
    if (pages !== 1) go(withPages(route, 1), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const stations = useData(R.filterStation, () => getStations(), 'stations', { live: false });
  const products = useData(R.filterProduct, () => getProducts(), 'products', { live: false });

  if (periodStatus === 'error') {
    return <ErrorState part={periodFailed[0] ?? 'the plant clock'} onRetry={() => window.location.reload()} />;
  }
  if (!period) return <Skeleton part={RF.rowsPart} height={320} />;

  const opts = { station, product, states, outsideOnly, batch };
  const filterKey = `${listing}:${sig}:${station ?? 'any'}:${product ?? 'any'}:${outsideOnly}:${states.join('+')}:${batch}:${period.live ? 'live' : 'closed'}`;
  const tabs = LISTINGS.map((id) => ({ id, label: R.listings[id] }));

  return (
    <div className="rg">
      <div className="rg-print" aria-hidden="true">
        <RegisterPrintHead
          from={period.from}
          to={period.to}
          at={asOf}
          batch={batch}
          shift={period.shift}
          fromShift={P.periodQuery(period).fromShift}
          toShift={P.periodQuery(period).toShift}
          title={`${R.printTitle}, ${R.listings[listing]}`}
        />
      </div>
      <Tabs
        label={R.listingLabel}
        value={listing}
        idPrefix="register"
        items={tabs}
        onChange={(id) => go(withListing(route, id as Listing))}
      />
      <div role="tabpanel" id={`register-panel-${listing}`} aria-labelledby={`register-tab-${listing}`} className="rg-panel">
        {listing === 'stock' ? (
          <StockPanel route={route} rank={rank} go={go} period={period} />
        ) : (
          <RowsPanel
            key={listing}
            route={route}
            rank={rank}
            go={go}
            period={period}
            listing={listing}
            outsideOnly={outsideOnly}
            states={states}
            station={station}
            product={product}
            pages={pages}
            batch={batch}
            setBatch={setBatch}
            search={search}
            setSearch={setSearch}
            filterKey={filterKey}
            opts={opts}
            stations={stations}
            products={products}
            dataAsOfUtc={line?.dataAsOfUtc ?? null}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the sack stock tab */

function StockPanel({ route, rank, go, period }: { route: ScreenProps['route']; rank: number; go: ScreenProps['go']; period: P.Period }) {
  return (
    <>
      <header>
        <h1 className="rg-h1">{R.listings.stock}</h1>
        <p className="rg-sub">{periodWords(period)}</p>
      </header>
      <StockLedger route={route} rank={rank} period={period} go={go} />
    </>
  );
}

/* ------------------------------------------------------------ the row listings */

type DataOf<T> = ReturnType<typeof useData<T>>;
type StationsData = Awaited<ReturnType<typeof getStations>>;
type ProductsData = Awaited<ReturnType<typeof getProducts>>;

interface RowsPanelProps {
  route: ScreenProps['route'];
  rank: number;
  go: ScreenProps['go'];
  period: P.Period;
  listing: Exclude<Listing, 'stock'>;
  outsideOnly: boolean;
  states: ConeState[];
  station: number | null;
  product: number | null;
  pages: number;
  batch: string;
  setBatch: (b: string) => void;
  search: string;
  setSearch: (s: string) => void;
  filterKey: string;
  opts: { station: number | null; product: number | null; states: ConeState[]; outsideOnly: boolean; batch: string };
  stations: DataOf<StationsData>;
  products: DataOf<ProductsData>;
  dataAsOfUtc: string | null;
}

async function loadPages(listing: Exclude<Listing, 'stock'>, period: P.Period, o: RowsPanelProps['opts'], pages: number): Promise<Loaded> {
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => getEvents(buildQuery(listing, period, { ...o, page: i + 1 }))),
  );
  const seen = new Set<string>();
  const rows: RegisterRow[] = [];
  for (const r of results) {
    for (const row of r.data.rows) {
      const k = String(row.event_id);
      if (!seen.has(k)) {
        seen.add(k);
        rows.push(row);
      }
    }
  }
  const first = results[0]!.data;
  return { rows, total: first.total, page: first };
}

function RowsPanel(p: RowsPanelProps) {
  const { route, rank, go, period, listing } = p;
  const polls = period.live;

  const rows = useData<Loaded>(RF.rowsPart, () => loadPages(listing, period, p.opts, p.pages), `register:rows:${p.filterKey}:${p.pages}`, { live: polls });
  // Keep the last good rows while the next page is read, so "Load more" does not blank the table.
  const kept = useRef<{ key: string; data: Loaded } | null>(null);
  if (rows.data) kept.current = { key: p.filterKey, data: rows.data };
  const data = rows.data ?? (kept.current?.key === p.filterKey ? kept.current.data : null);

  // The "of those, N failed the weight check" count: needed only for the plain cones headline.
  const wantsFails = listing === 'cones' && !p.outsideOnly && p.states.length === 0;
  const fails = useData(
    'the weight-check count',
    () => (wantsFails ? getEvents({ ...buildQuery('rejected', period, { ...p.opts, states: [], outsideOnly: false }), pageSize: 1 }) : wait()),
    `register:fails:${p.filterKey}:${wantsFails}`,
    { live: polls },
  );

  const countUnknown = !!data?.page.dataIssues?.some((i) => i.field === 'total');
  const total = countStateOf(rows.error, data?.total);
  const failCount = countStateOf(fails.error, fails.data?.data.total);
  const what = periodWords(period);
  const headline = countUnknown
    ? R.countUnknown
    : countLine({ what, listing, total, weightFails: failCount, outsideOnly: p.outsideOnly, states: p.states });

  // The other data sets this period holds, said once and with a switch (never silent about which one is listed).
  const tally = data?.page.generations ?? [];
  const currentKey = data?.page.generation?.generation?.key ?? null;
  const others = tally.filter((g) => g.key !== currentKey);

  const stationList = p.stations.data?.stations ?? [];
  const stationName = (id: number | null | undefined): string =>
    id === null || id === undefined ? R.noStation : RESERVED.stationLabel(stationList.find((s) => s.stationId === id), id);

  const type = rowType(listing);
  const visible = useMemo(() => {
    const all = data?.rows ?? [];
    if (p.search.trim() === '') return all;
    return all.filter((r) =>
      matchesSearch([r.event_id, r.sack_num, r.source_station, stationName(r.source_station ?? null), r.product_name, r.reject_label], p.search),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, p.search, stationList]);

  const columns = useMemo<Column<RegisterRow>[]>(() => {
    const time: Column<RegisterRow> = { key: 'time', header: R.colTime, sortValue: (r) => r.production_ts_utc, render: (r) => formatClock(r.production_ts_utc, true) };
    const day: Column<RegisterRow> = { key: 'day', header: R.colDay, sortValue: (r) => String(r.shift_date).slice(0, 10), render: (r) => formatDate(`${String(r.shift_date).slice(0, 10)}T12:00:00Z`) };
    const stationCol: Column<RegisterRow> = { key: 'station', header: R.colStation, render: (r) => stationName(r.source_station ?? null) };
    const record: Column<RegisterRow> = { key: 'record', header: R.colRecord, numeric: true, render: (r) => String(r.event_id) };
    const prod: Column<RegisterRow> = { key: 'product', header: R.colProduct, render: (r) => r.product_name ?? R.noProductOnRow };
    if (type === 'sack') {
      return [
        time,
        day,
        { key: 'sack', header: R.colSack, numeric: true, render: (r) => (r.sack_num == null ? '–' : String(r.sack_num)) },
        { key: 'weight', header: R.colWeight, numeric: true, sortValue: (r) => r.weight_kg ?? null, render: (r) => (r.weight_kg == null ? '–' : `${r.weight_kg.toFixed(2)} kg`) },
        { key: 'scale', header: R.colScale, render: (r) => (r.in_range === false ? <span className="rg-fail">{R.failedWeight}</span> : R.passedWeight) },
      ];
    }
    if (type === 'reject') {
      return [
        time,
        day,
        stationCol,
        record,
        {
          key: 'reason',
          header: R.colReason,
          render: (r) => (
            <span className="rg-fail">
              {r.reject_label ?? (r.reject_type === 'weight' ? R.failedWeight : reasonName({ label: null, tubeCode: r.tube_inspect_code ?? null, materialCode: r.material_inspect_code ?? null }))}
            </span>
          ),
        },
        prod,
      ];
    }
    return [
      time,
      day,
      stationCol,
      record,
      { key: 'weight', header: R.colWeight, numeric: true, sortValue: (r) => r.weight_g ?? null, render: (r) => (r.weight_g == null ? '–' : `${Math.round(r.weight_g).toLocaleString('en-GB')} g`) },
      {
        key: 'state',
        header: R.colState,
        render: (r) => {
          const v = coneVerdict(r);
          return <span className={v.tone === 'fail' ? 'rg-fail' : v.tone === 'note' ? 'rg-note-cell' : undefined}>{v.text}</span>;
        },
      },
      prod,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, stationList]);

  const hasMore = data !== null && !countUnknown && data.rows.length < data.total && p.pages < MAX_PAGES;
  const afterNewest = !!p.dataAsOfUtc && P.periodAfterNewest(period, p.dataAsOfUtc);
  const showNewest = afterNewest && p.dataAsOfUtc
    ? () => {
        const day = p.dataAsOfUtc!.slice(0, 10);
        go({ ...route, keys: { ...route.keys, p: 'pick', from: day, to: day } });
      }
    : undefined;

  const emptyMessage =
    p.search.trim() !== '' && data !== null && data.rows.length > 0
      ? R.nothingMatch
      : p.outsideOnly
        ? R.nothingOutside
        : listing === 'inspectionRejects'
          ? R.nothingInspection
          : listing === 'rejected'
            ? R.nothingWeightFail
            : R.nothing;

  const exportHref = eventsExportUrl(buildQuery(listing, period, { ...p.opts, page: 1 }));

  return (
    <>
      <header>
        <h1 className="rg-h1">{headline}</h1>
        <p className="rg-sub">{R.question}</p>
      </header>

      {others.length > 0 && (
        <p className="rg-note rg-noprint">
          {p.batch === 'auto' ? (
            <>
              {R.periodHoldsOther(others.reduce((t, g) => t + g.rows, 0).toLocaleString('en-GB'))}{' '}
              <button type="button" className="ui-link" onClick={() => p.setBatch(others[0]!.key)}>{R.showOther}</button>
            </>
          ) : (
            <>
              {R.showingOther}{' '}
              <button type="button" className="ui-link" onClick={() => p.setBatch('auto')}>{R.backToDefault}</button>
            </>
          )}
        </p>
      )}

      <div className="rg-bar rg-noprint">
        <div className="rg-filters">
          {listing !== 'sacks' && (
            <SelectField
              label={R.filterStation}
              value={p.station === null ? '' : String(p.station)}
              placeholder={R.all}
              onChange={(v) => go(withKey(route, 'st', v), { replace: true })}
              options={stationList.map((s) => ({ value: String(s.stationId), label: RESERVED.stationLabel(s, s.stationId) }))}
              hint={p.stations.status === 'error' ? R.stationsUnavailable : undefined}
            />
          )}
          <SelectField
            label={R.filterProduct}
            value={p.product === null ? '' : String(p.product)}
            placeholder={R.all}
            onChange={(v) => go(withKey(route, 'pr', v), { replace: true })}
            options={(p.products.data?.products ?? []).map((x) => ({ value: String(x.productId), label: x.description ?? x.lotCode ?? `Product ${x.productId}` }))}
            hint={p.products.status === 'error' ? R.productsUnavailable : listing === 'sacks' && p.product !== null ? R.productNotForSacks : undefined}
          />
          <div className="wr-field">
            <label className="wr-field__label" htmlFor="register-search">{R.search}</label>
            <input
              id="register-search"
              className="wr-input"
              type="search"
              value={p.search}
              aria-describedby="register-search-hint"
              onChange={(e) => p.setSearch(e.target.value)}
            />
            <div id="register-search-hint" className="wr-field__hint">{R.searchHint}</div>
          </div>
        </div>
        <div className="rg-actions">
          <WriteGate rank={rank} minRank={EXPORT_MIN_RANK}>
            <a className="ui-btn" href={exportHref}>{R.exportCsv}</a>
          </WriteGate>
          <button type="button" className="ui-btn" disabled={rows.status === 'loading' && !data} onClick={() => window.print()}>
            {R.print}
          </button>
        </div>
      </div>

      {p.outsideOnly && (
        <div className="rg-chips rg-noprint">
          <Chip onRemove={() => go(withoutHop(route, listing), { replace: true })}>{R.outsideChip}</Chip>
        </div>
      )}

      {listing === 'cones' && !p.outsideOnly && (
        <div className="rg-states rg-noprint" role="group" aria-label={R.filterState}>
          <span className="rg-states__label">{R.filterState}</span>
          <button type="button" className="rg-state" aria-pressed={p.states.length === 0} onClick={() => go(withKey(route, 'rcs', null), { replace: true })}>
            {R.anyState}
          </button>
          {CONE_STATES.map((s) => (
            <button
              key={s}
              type="button"
              className="rg-state"
              aria-pressed={p.states.includes(s)}
              title={R.states[s]}
              onClick={() => {
                const next = p.states.includes(s) ? p.states.filter((x) => x !== s) : [...p.states, s];
                go(withKey(route, 'rcs', next.length ? next.join(',') : null), { replace: true });
              }}
            >
              {R.statesShort[s]}
            </button>
          ))}
        </div>
      )}

      <DataTable<RegisterRow>
        caption={R.tableCaption(R.listings[listing])}
        columns={columns}
        rows={visible}
        rowKey={(r) => String(r.event_id)}
        onRowOpen={(r) => go(sheetFor(route, type, r.event_id))}
        total={data && !countUnknown ? data.total : undefined}
        hasMore={hasMore}
        onLoadMore={() => go(withPages(route, p.pages + 1), { replace: true })}
        loadingMore={rows.data === null && data !== null}
        loading={rows.status === 'loading' && !data}
        loadingRows={8}
        error={rows.status === 'error' && !data ? <ErrorState part={RF.rowsPart} cause={rows.error} onRetry={rows.refresh} /> : undefined}
        empty={
          countUnknown ? (
            <EmptyState message={R.countUnknown} />
          ) : p.search.trim() === '' && afterNewest ? (
            <EmptyState newest={p.dataAsOfUtc} onShowNewest={showNewest} />
          ) : (
            <EmptyState message={emptyMessage} />
          )
        }
      />
      {rows.staleError && <p className="rg-note" role="status">{RF.rowsPart}: {rows.staleError}</p>}
      {data && !countUnknown && data.total > 0 && (
        <p className="rg-note rg-noprint">
          {period.live ? `${R.liveNote} ` : ''}
          {R.perPage(PAGE_SIZE, data.total.toLocaleString('en-GB'))}
        </p>
      )}
    </>
  );
}
