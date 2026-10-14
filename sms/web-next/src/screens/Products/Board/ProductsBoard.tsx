/**
 * Products & PDAS > Board (task E9; board design/redesign-2026-10/mockups/PdasBoard.dc.html).
 *
 * "What is each station making?" One card per station, built from `GET /api/machines/running`:
 *   - running: the product on the latest cone, since when (VERIFY-D2-D4: `runStartUtc`, and "since at least"
 *     when no change was found in the lookback), and what it replaced when the server found a change;
 *   - idle: the last product it stamped and the time of that cone (F-1). SMS cannot know when an operator
 *     chose a product, only which product the cones carried.
 * Beside the cards: the PDAS connection (writes on or off, the server's own reason), the line-wide default
 * product for readings that carry none, and the timeline of product changes (F-2: timed at the first cone
 * of the new product). Writes stay on the other tabs, except the SMS-only default product, which is
 * gated on rank and never touches PDAS.
 */
import { useMemo, useState } from 'react';
import { getCurrentProduct, getProducts, getProduction, setCurrentProduct, type ProductOption, type TimelineEntry } from '../../../bridge/api';
import { fmt, generationWords, period as P, productLabel } from '../../../bridge/lib';
import { W } from '../../../bridge/words';
import { C, withFragments, FRAGMENTS } from '../../../copy';
import { fmtAppDate, fmtDate, fmtTime } from '../../../lib/fmt';
import { SHAPE, liveKey, useData, useMachinesRunning, usePeriod, type DataState } from '../../../data';
import { ENGINEER_RANK } from '../../../ranks';
import { Disclosure } from '../../../ui/Disclosure';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { ReasonField, SelectField } from '../../../ui/Field';
import { Segmented } from '../../../ui/Segmented';
import { Skeleton } from '../../../ui/Skeleton';
import { WriteGate } from '../../../ui/WriteGate';
import { routeFor } from '../../../ui/nav';
import type { ScreenProps } from '../../registry';
import { PdasStatusCard, usePdasWriteStatus } from '../PdasStatusCard';
import { ProductsTabs } from '../ProductsTabs';
import { applyFilter, buildCards, buildChanges, limitsText, productFacts, type BoardCard, type BoardChange, type BoardProduct, type Filter, type ProductFacts } from './model';
import '../products.css';
import './board.css';
const PC = withFragments(C.products, FRAGMENTS.productsParts);

const B = PC.board;

/** "1 Sep, 19:55": a plant-clock instant without the year (the period on screen carries it). */
export function stamp(at: string): string {
  return `${fmtDate(at).replace(/ \d{4}$/, '')}, ${fmtTime(at)}`;
}

function key(period: P.Period): string {
  const q = P.periodQuery(period);
  return [q.from, q.to, q.shift ?? '', q.fromShift ?? '', q.toShift ?? '', liveKey(period)].join('|');
}

export function ProductsBoardScreen(props: ScreenProps) {
  const per = usePeriod();
  return (
    <div className="pr-page">
      <ProductsTabs route={props.route} go={props.go} />
      {per.period ? (
        <Body {...props} period={per.period} />
      ) : per.status === 'error' ? (
        <ErrorState part={C.periodUi.title.toLowerCase()} cause={C.periodUi.clockUnread} />
      ) : (
        <Skeleton part={C.periodUi.loading} height={320} />
      )}
    </div>
  );
}

function Body({ route, rank, go, period }: ScreenProps & { period: P.Period }) {
  const machines = useMachinesRunning();
  const products = useData(B.partProducts, () => getProducts(), 'products:list', { live: false });
  const current = useData(B.partDefault, () => getCurrentProduct(), 'products:current', { live: false });
  const cones = useData(
    B.partCones,
    () => getProduction({ ...P.periodQuery(period), groupBy: 'station' }),
    `products:cones:${key(period)}`,
    { live: period.live, shape: SHAPE.productionRows },
  );
  const status = usePdasWriteStatus();
  const [filter, setFilter] = useState<Filter>('all');

  const list = products.data ? products.data.products : null;
  const labels = useMemo(() => productLabel.distinctProductLabels(list ?? []), [list]);
  const facts = useMemo(() => productFacts(list ?? [], labels), [list, labels]);

  const openStation = (n: number) => go({ ...route, sheet: { kind: 'station', id: String(n) } });
  const toChangeover = () => go(routeFor(route, { s: 'products', t: 'changeover' }));
  const toCatalogue = (id: number) => {
    const next = routeFor(route, { s: 'products', t: 'catalogue' });
    go({ ...next, keys: { ...next.keys, pr: String(id) } });
  };
  const toHistory = () => go(routeFor(route, { s: 'products', t: 'limits' }));

  const changeoverHint = status.data ? (status.data.enabled ? B.changeoverOn : B.changeoverOff) : B.changeoverUnknown;

  let stationsBlock;
  let headline: string;
  let asAt: string | null = null;
  let generationLine: string | null = null;
  let changes: BoardChange[] = [];

  if (machines.status === 'loading') {
    headline = '';
    stationsBlock = <Skeleton part={B.partMachines} height={360} onRetry={machines.refresh} />;
  } else if (machines.status === 'error' || !machines.data) {
    headline = '';
    stationsBlock = <ErrorState part={B.partMachines} cause={machines.error ?? undefined} onRetry={machines.refresh} />;
  } else {
    const md = machines.data.data;
    const conesByStation = cones.data
      ? new Map(cones.data.data.rows.map((r) => [Number(r.group), r.cones] as const))
      : null;
    const cards = buildCards(md.machines, facts, conesByStation);
    const nRun = cards.filter((c) => c.running).length;
    const nIdle = cards.length - nRun;
    headline = cards.length === 0 ? B.headlineEmpty : nRun === 0 ? B.headlineNone(nIdle) : B.headlineRunning(nRun, md.materialsRunning, nIdle);
    asAt = md.asOfUtc ? stamp(md.asOfUtc) : null;
    if (md.generation && generationWords.hasNewerElsewhere(md.generation) && md.asOfUtc) {
      generationLine = generationWords.quietBecauseGeneration(md.generation, stamp(md.asOfUtc), null);
    }
    changes = buildChanges(cards);
    const shown = applyFilter(cards, filter);
    stationsBlock = (
      <section className="card pb-card" aria-labelledby="pb-stations-title">
        <div className="pb-card__head">
          <h2 id="pb-stations-title" className="pb-card__title">{B.stationsTitle}</h2>
          <Segmented
            label={B.filterLabel}
            value={filter}
            onChange={(id) => setFilter(id as Filter)}
            options={[
              { id: 'all', label: B.filterAll(cards.length) },
              { id: 'running', label: B.filterRunning(nRun) },
              { id: 'idle', label: B.filterIdle(nIdle) },
            ]}
          />
        </div>
        {products.status === 'error' && (
          <p className="pr-fail" role="alert">
            {B.productsFailed}{' '}
            <button type="button" className="ui-link" onClick={products.refresh}>{C.tryAgain}</button>
          </p>
        )}
        {cones.status === 'error' && (
          <p className="pr-fail" role="alert">
            {B.conesFailed}{' '}
            <button type="button" className="ui-link" onClick={cones.refresh}>{C.tryAgain}</button>
          </p>
        )}
        {cards.length === 0 ? (
          <EmptyState message={B.headlineEmpty} />
        ) : shown.length === 0 ? (
          <EmptyState message={B.emptyFilter} action={{ label: B.showAll, onClick: () => setFilter('all') }} />
        ) : (
          <ul className="pb-grid">
            {shown.map((c) => (
              <li key={c.station}>
                <StationCard card={c} onOpen={() => openStation(c.station)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <>
      <header className="pr-head">
        <div>
          <h1 className="pr-title">{B.title}</h1>
          {headline && <p className="pr-sentence"><b>{headline}</b></p>}
          <p className="caption">
            {B.asked}
            {asAt ? ` ${B.shownAsAt(asAt)}` : ''}
          </p>
        </div>
        <div className="pb-cta">
          <button type="button" className="ui-btn" onClick={toChangeover}>{B.startChangeover}</button>
          <span className="caption">{changeoverHint}</span>
        </div>
      </header>
      {generationLine && <p className="pr-fail">{generationLine}</p>}

      <div className="pb-top">
        <PdasStatusCard status={status} />
        <DefaultProduct
          rank={rank}
          current={current}
          products={list}
          productsFailed={products.status === 'error'}
          facts={facts}
          labels={labels}
          onSeeCatalogue={toCatalogue}
        />
      </div>

      {stationsBlock}

      <section className="card pb-card" aria-labelledby="pb-changes-title">
        <div className="pb-card__head">
          <div>
            <h2 id="pb-changes-title" className="pb-card__title">{B.changesTitle}</h2>
            <span className="caption">{B.changesNote}</span>
          </div>
          <button type="button" className="ui-link" onClick={toHistory}>{B.allActions}</button>
        </div>
        {machines.data ? (
          changes.length === 0 ? (
            <p className="pr-fail">{B.changesNone}</p>
          ) : (
            <ol className="pb-changes">
              {changes.map((ch) => (
                <li key={ch.station}>
                  <time className="pb-changes__when" dateTime={ch.atUtc}>{stamp(ch.atUtc)}</time>
                  <button type="button" className="ui-link" onClick={() => openStation(ch.station)}>{ch.stationName ?? B.station(ch.station)}</button>
                  <span>{B.changeLine(describe(ch.to), ch.from ? describe(ch.from) : null)}</span>
                </li>
              ))}
            </ol>
          )
        ) : (
          <p className="pr-fail">{B.machinesFailed}</p>
        )}
      </section>

      <p className="pr-note">{B.notReached}</p>
      <Disclosure id="board-how" label={B.howTitle}>
        <p>{B.howBody}</p>
      </Disclosure>
    </>
  );
}

function describe(p: BoardProduct | null): string {
  if (!p) return B.noProduct;
  return p.label;
}

/* ------------------------------------------------------------ station card */

function StationCard({ card, onOpen }: { card: BoardCard; onOpen: () => void }) {
  const name = card.stationName ?? B.station(card.station);
  const p = card.product;
  const limits = p ? limitsText(p, fmt.fmtG) : null;
  return (
    <article className={`pb-st${card.running ? '' : ' pb-st--idle'}`} data-station={card.station} data-running={card.running}>
      <div className="pb-st__top">
        <button type="button" className="ui-link pb-st__name" aria-label={B.openStation(name)} onClick={onOpen}>{name}</button>
        <span className={`pb-st__badge${card.running ? ' pb-st__badge--run' : ''}`}>{card.running ? B.running : B.idle}</span>
      </div>

      {!card.running && <p className="pb-st__kicker">{B.lastStampedHeading}</p>}
      {p ? (
        <>
          <p className="pb-st__code">
            {p.label}
            {p.retired && <span className="pb-st__retired">{W.retiredProduct.marker}</span>}
          </p>
          <p className="pb-st__colour">{p.colour ?? ' '}</p>
          <p className="pb-st__limits">{limits ?? B.noTarget}</p>
        </>
      ) : (
        <>
          <p className="pb-st__code pb-st__code--none">{B.noProduct}</p>
          {!card.running && <p className="pb-st__colour">{B.noProductWhy}</p>}
        </>
      )}

      <dl className="pb-st__facts">
        <div>
          <dt>{card.running ? (card.since?.atLeast ? B.sinceAtLeast : B.since) : B.lastStamped}</dt>
          <dd>{card.running ? (card.since ? stamp(card.since.at) : '—') : card.lastStampedUtc ? stamp(card.lastStampedUtc) : '—'}</dd>
        </div>
        <div>
          <dt>{B.conesInPeriod}</dt>
          <dd>{card.conesInPeriod === null ? '—' : fmt.fmtInt(card.conesInPeriod)}</dd>
        </div>
        <div>
          <dt>{B.lastCone}</dt>
          <dd>{card.lastConeUtc ? stamp(card.lastConeUtc) : B.noCone}</dd>
        </div>
      </dl>

      {card.change && (
        <p className="pb-st__change">
          {card.change.from
            ? B.changedFrom(describe(card.change.from), stamp(card.change.atUtc))
            : B.changedFromNone(stamp(card.change.atUtc))}
        </p>
      )}
    </article>
  );
}

/* ------------------------------------------------------- default product */

interface DefaultProps {
  rank: number;
  current: DataState<{ current: TimelineEntry | null }>;
  products: ProductOption[] | null;
  productsFailed: boolean;
  facts: Map<number, ProductFacts>;
  labels: Map<number, string>;
  onSeeCatalogue: (productId: number) => void;
}

function DefaultProduct({ rank, current, products, productsFailed, facts, labels, onSeeCatalogue }: DefaultProps) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  let body;
  if (current.status === 'loading') body = <Skeleton part={B.partDefault} height={96} onRetry={current.refresh} />;
  else if (current.status === 'error' || !current.data) body = <ErrorState part={B.partDefault} cause={current.error ?? undefined} onRetry={current.refresh} />;
  else {
    const cur = current.data.current;
    const f = cur ? facts.get(cur.productId) : undefined;
    const limits = f ? limitsText(f, fmt.fmtG) : null;
    body = cur ? (
      <>
        <p className="pb-def__name">
          {f ? f.label : cur.productLabel}
          {f?.retired && <span className="pb-st__retired">{W.retiredProduct.marker}</span>}
        </p>
        {limits && <p className="pb-st__limits">{limits}</p>}
        <p className="pds__note">{cur.changedBy ? B.defaultSetBy(cur.changedBy, fmtAppDate(cur.effectiveFrom)) : B.defaultSetOn(fmtAppDate(cur.effectiveFrom))}</p>
        <p className="pds__note">{B.defaultOnlyUsed}</p>
        <button type="button" className="ui-link" onClick={() => onSeeCatalogue(cur.productId)}>{B.defaultSeeCatalogue}</button>
      </>
    ) : (
      <p className="pds__note">{B.defaultNone}</p>
    );
  }

  const chosen = pick ? products?.find((p) => String(p.productId) === pick) : undefined;
  const chosenLabel = chosen ? (labels.get(chosen.productId) ?? chosen.description ?? `Product ${chosen.productId}`) : '';

  const save = async () => {
    if (!chosen) return;
    setBusy(true);
    setErr(null);
    try {
      await setCurrentProduct(chosen.productId, reason.trim() || undefined);
      setConfirm(false);
      setOpen(false);
      setPick('');
      setReason('');
      setSaved(true);
      current.refresh();
    } catch (e) {
      setConfirm(false);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card pb-def" aria-labelledby="pb-def-title">
      <h2 id="pb-def-title" className="pds__title">{B.defaultTitle}</h2>
      {body}
      <WriteGate rank={rank} minRank={ENGINEER_RANK}>
        <div className="pb-def__write">
          {!open ? (
            <button type="button" className="wr-btn" onClick={() => { setOpen(true); setSaved(false); }}>{B.defaultChange}</button>
          ) : productsFailed || !products ? (
            <p className="pr-fail" role="alert">{B.defaultListFailed}</p>
          ) : (
            <form
              className="pb-def__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (chosen) setConfirm(true);
              }}
            >
              <SelectField
                label={B.defaultPick}
                value={pick}
                onChange={setPick}
                placeholder={B.defaultPickPlaceholder}
                options={products.map((p) => ({
                  value: String(p.productId),
                  label: `${labels.get(p.productId) ?? p.description ?? p.productId}${p.activeFlag === false ? ` ${W.retiredProduct.marker}` : ''}`,
                }))}
              />
              <ReasonField label={B.defaultReason} value={reason} onChange={setReason} minLength={0} hint={B.defaultReasonHint} />
              <div className="pb-def__actions">
                <button type="button" className="wr-btn" onClick={() => setOpen(false)}>{B.defaultCancel}</button>
                <button type="submit" className="ui-btn" disabled={!chosen}>{B.defaultConfirm}</button>
              </div>
            </form>
          )}
        </div>
      </WriteGate>
      {saved && <p className="pds__note" role="status">{B.defaultSaved}</p>}
      {err && (
        <p className="pr-fail" role="alert">
          {B.defaultWriteFailed} {err}
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        title={B.defaultConfirmTitle}
        confirmLabel={B.defaultConfirm}
        busy={busy}
        onConfirm={save}
        onCancel={() => setConfirm(false)}
      >
        {B.defaultConfirmBody(chosenLabel)}
      </ConfirmDialog>
    </section>
  );
}
