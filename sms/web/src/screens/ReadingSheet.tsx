/**
 * One reading, in a sheet over whatever screen opened it.
 *
 * Replaces both the sticky detail rail and the full record page — two surfaces
 * that described the same reading, and between them leaked merge-key
 * uniqueness, transform version, source system and a data-quality collision id
 * to somebody who had asked what a cone weighed.
 *
 * WHAT IT MAY AND MAY NOT SAY:
 *  - The reading's STATE, in the same words as the register's column — the
 *    one server-side classification (roadmap Phase 4, 14 Sep 2026): the
 *    scale's verdict when it rejected the cone, the product's tolerance when
 *    the scale passed it, "not judged" when there was nothing to judge by.
 *    When the two facts differ, both are printed, and the sentence says IFL
 *    has not yet confirmed which governs.
 *  - The product's limits ONLY when a product was in force at this reading's
 *    time. When none was, it says so and computes nothing; the old app applied
 *    today's tolerance to a reading from weeks earlier and printed a
 *    difference that meant nothing.
 *  - On a SACK, one line about the cones weighed since the previous sack, with
 *    the caveat printed. Never on a cone, where the same line would read as a
 *    packing list. The plant records no link between a cone and its sack, and
 *    the count between two consecutive sacks has been measured anywhere from
 *    0 to 254.
 *  - Provenance lives behind a disclosure, for the one reader in a hundred who
 *    wants to know where the row came from — and since roadmap Phase 3 (14
 *    Sep 2026) it answers the question in full: source table and generation,
 *    the plant's row id, when the plant wrote it and when this system read
 *    it, the transform version, and how the product was determined. Every
 *    line prints a field the server sent; nothing is reconstructed here.
 */
import { useEffect, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Details, Loading } from '../ui/bits';
import { W } from '../lib/words';
import { batchName } from '../lib/batchName';
import { fmtAppInstant, fmtClock, fmtClockSec, fmtDayLong, fmtG, fmtKg } from '../lib/fmt';
import { describeAttribution } from '../lib/provenance';
import {
  getEventDetail, getEvents, getProductAt, getStations, stationLabel,
  type ProductAtData, type Provenance, type RegisterRow, type RegisterType, type StationRow,
} from '../api';

interface State {
  row: (RegisterRow & Record<string, unknown>) | null;
  product: ProductAtData | null;
  stations: StationRow[];
  /** Sacks only: cones weighed since the previous sack, and that sack's time. */
  around: { cones: number; sinceUtc: string } | null;
  error: string | null;
}

export function ReadingSheet({
  type,
  id,
  onClose,
  onOpenProductReport,
  onOpenProductCatalogue,
}: {
  type: RegisterType;
  id: string;
  onClose: () => void;
  /**
   * Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md §6.4
   * "the product in force at a reading → its report"). Opens the Product
   * report for that product, narrowed to this reading's own production day.
   */
  onOpenProductReport: (productId: number, day: string) => void;
  /**
   * UX Phase 6 Brief 1 (16 Sep 2026): the second half of the same §6.4 row —
   * "the product in force at a reading → Product › Catalogue, that
   * product" — which had no destination until the Catalogue tab existed.
   */
  onOpenProductCatalogue: (productId: number) => void;
}) {
  const [s, setS] = useState<State>({ row: null, product: null, stations: [], around: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [detail, stations] = await Promise.all([getEventDetail(type, id), getStations()]);
        if (cancelled) return;
        const row = detail.row;

        // The product is resolved at THIS reading's production time, never
        // "the product recorded today".
        // The row's OWN product when it carries one (MaterialId, Sep 2026):
        // without it this sheet judged a September cone against the line-wide
        // timeline product — a retired July material.
        // The weight goes too, so the verdict comes back computed server-side
        // by the one implementation every screen shares. Sacks have no
        // product limits (a cone setpoint in grams against a sack in kg is
        // the 1960 kg "setpoint" spc.ts remembers), so none is sent for them.
        const product = await getProductAt(
          row.production_ts_utc,
          row.material_id ?? undefined,
          type === 'sack' ? undefined : (row.weight_g ?? undefined),
          type === 'sack' ? undefined : row.in_range,
        );
        if (cancelled) return;

        let around: State['around'] = null;
        if (type === 'sack') {
          around = await conesSincePreviousSack(row.production_ts_utc, row.provenance?.epochId ?? null);
          if (cancelled) return;
        }
        setS({ row, product, stations: stations.stations, around, error: null });
      } catch (e) {
        if (!cancelled) setS((p) => ({ ...p, error: String((e as Error).message ?? e) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  const title = type === 'sack' ? 'Sack' : type === 'reject' ? 'Rejected cone' : 'Cone';

  return (
    <Sheet title={title} eyebrow={eyebrow(type, s)} onClose={onClose}>
      {s.error ? (
        <p className="state err">{W.couldNotLoad}</p>
      ) : !s.row ? (
        <Loading />
      ) : (
        <Body type={type} state={s} onOpenProductReport={onOpenProductReport} onOpenProductCatalogue={onOpenProductCatalogue} />
      )}
    </Sheet>
  );
}

function eyebrow(type: RegisterType, s: State): string {
  const noun = type === 'sack' ? 'Sack' : type === 'reject' ? 'Rejected cone' : 'Cone';
  if (!s.row) return noun;
  const st = s.row.source_station;
  const station = st != null ? ` · ${stationLabel(s.stations.find((x) => x.stationId === st), st)}` : '';
  return `${noun}${station} · ${W.shiftName[s.row.shift_code as 'morning'] ?? s.row.shift_code} shift`;
}

/**
 * What a reject was rejected FOR, in the words the Rejects screen uses: the
 * manager's label when one exists, otherwise the kind and the raw code pair.
 * IFL has not said what the inspection codes mean (Q10), so a bare pair is
 * never presented as a reason.
 */
function rejectReason(row: RegisterRow): string {
  if (row.reject_label) return row.reject_label;
  if (row.reject_type === 'weight') return W.readings.weightReject;
  const pair = `${row.tube_inspect_code ?? '—'}/${row.material_inspect_code ?? '—'}`;
  return W.readings.qualityRejectCode(pair);
}

function Body({
  type, state, onOpenProductReport, onOpenProductCatalogue,
}: {
  type: RegisterType;
  state: State;
  onOpenProductReport: (productId: number, day: string) => void;
  onOpenProductCatalogue: (productId: number) => void;
}) {
  const row = state.row!;
  const isSack = type === 'sack';
  const isReject = type === 'reject';
  // reject_event has no in_range column — the row IS a rejection. Until 14
  // Sep 2026 this read `row.in_range === false`, which is undefined on a
  // reject, and the sheet opened on a rejected cone with the word "Passed".
  const rejectedByScale = isReject || row.in_range === false;
  const p = state.product;
  // Server-side, from ProductTimeline.verdict(). This sheet used to keep its
  // own judge(); the register's "outside limits" column and this sentence
  // could then have disagreed about the same cone.
  const verdict = !isSack && p?.verdict && p.verdict.inside != null ? p.verdict : null;
  // The one classification: the row's own `state` from the detail endpoint
  // (the same CASE the register lists it by), with the product-at verdict's
  // copy as the fallback for an API answering without it.
  const coneState = isSack || isReject ? null : (row.state ?? p?.verdict?.state ?? null);
  const stateTone = coneState == null ? (rejectedByScale ? 'acc' : '') : coneState === 'within' ? '' : coneState === 'unknown' ? 'mut' : 'acc';

  return (
    <>
      {/* A quality reject is rejected before it is weighed and carries no weight. */}
      <div className="big">{isSack ? fmtKg(row.weight_kg) : row.weight_g == null ? W.readings.notWeighed : fmtG(row.weight_g)}</div>
      <div className={stateTone} style={{ marginTop: 8, fontWeight: 500 }}>
        {isReject
          ? W.readings.rejectedFor(rejectReason(row))
          : coneState != null
            ? W.cone.state[coneState]
            : rejectedByScale
              ? W.rejectedByScale
              : W.passed}
      </div>

      {/* The second fact — the product's tolerance, or why there is no
          judgement — for a reading that has a weight. One sentence per
          state, and both facts when the scale and the tolerance differ. */}
      {!isSack && row.weight_g != null && (
        <div className="g" style={{ marginTop: 6 }}>
          {coneState === 'unknown' && p?.verdict?.unknownReason === 'implausible' && p.plausibility ? (
            W.cone.notJudged.implausible(fmtG(p.plausibility.loG), fmtG(p.plausibility.hiG))
          ) : p?.product == null ? (
            coneState === 'unknown' ? W.cone.notJudged.no_limits : W.noProductThen
          ) : p.limits == null ? (
            'The product recorded at this time carries no target weight, so there are no limits to compare against.'
          ) : verdict == null ? null : coneState === 'rejected' ? (
            verdict.inside
              ? W.cone.rejectedInside(p.limits.label)
              : W.cone.rejectedOutside(describeMiss(verdict.outsideByG!), p.limits.label)
          ) : coneState === 'low' || coneState === 'high' ? (
            <span className="acc">{W.cone.lowHigh(describeMiss(verdict.outsideByG!), p.limits.label, verdict.scalePassed ?? null)}</span>
          ) : verdict.inside ? (
            W.cone.withinOf(p.limits.label)
          ) : (
            <span className="acc">
              {W.alsoOutsideProduct(p.limits.label, describeMiss(verdict.outsideByG!))}
            </span>
          )}
        </div>
      )}

      <dl className="kv" style={{ marginTop: 24 }}>
        {/* A reject's time is when the rejection was recorded — a quality
            reject never reaches the scale, so "Weighed" would be untrue. */}
        <dt>{isReject || (isSack && row.production_ts_is_insert_time) ? W.readings.recorded : W.readings.weighed}</dt>
        <dd>
          {fmtDayLong(row.shift_date)}, {fmtClock(row.production_ts_utc)}
        </dd>
        <dt>Shift</dt>
        <dd>{W.shiftName[row.shift_code as 'morning'] ?? row.shift_code}</dd>
        {!isSack && row.source_station != null && (
          <>
            <dt>Station</dt>
            <dd>{stationLabel(state.stations.find((x) => x.stationId === row.source_station), row.source_station)}</dd>
          </>
        )}
        {isSack && row.sack_num != null && (
          <>
            <dt>{W.readings.sackNo}</dt>
            <dd>{row.sack_num}</dd>
          </>
        )}
        {/* Null on a reject: the source records no id for those rows. */}
        <dt>{W.readings.record}</dt>
        <dd>{row.source_row_id == null ? '—' : String(row.source_row_id)}</dd>
        {p?.product && (
          <>
            <dt>Product then</dt>
            <dd>
              {p.product.label}
              {p.productActive === false && <span className="mut sm" style={{ marginLeft: 6 }}>{W.retiredProduct.marker}</span>}
            </dd>
          </>
        )}
      </dl>

      {p?.product && (
        <p style={{ marginTop: 8 }}>
          <button
            type="button"
            className="linkish"
            onClick={() => onOpenProductReport(p.product!.productId, String(row.shift_date).slice(0, 10))}
          >
            {W.readings.seeProductReport}
          </button>{' '}
          <span className="mut sm">· {W.readings.seeProductReportNote}</span>
          {' · '}
          <button type="button" className="linkish" onClick={() => onOpenProductCatalogue(p.product!.productId)}>
            {W.readings.seeProductCatalogue}
          </button>{' '}
          <span className="mut sm">· {W.readings.seeProductCatalogueNote}</span>
        </p>
      )}

      {/* Finding M7: named "Recorded" above rather than "Weighed" for exactly
          this reason, stated once here rather than repeated per row in the
          list — every sack carries this flag, so it would be noise there. */}
      {isSack && row.production_ts_is_insert_time && (
        <p className="mut sm" style={{ marginTop: 22 }}>{W.readings.insertTimeCaveat}</p>
      )}

      {/* Sacks only, once, with the caveat in the same sentence. */}
      {isSack && state.around && (
        <p className="mut sm" style={{ marginTop: 8 }}>
          {W.readings.aroundSack(state.around.cones)}
        </p>
      )}

      <Details summary={W.readings.provenance}>
        <ProvenanceBlock row={row} />
      </Details>
    </>
  );
}

/**
 * Where the reading came from, line by line (roadmap Phase 3, 14 Sep 2026).
 *
 * Reads ONLY `row.provenance`. The row also carries `source_row_id`,
 * `source_epoch_label`, `ingest_ts_utc` and `transform_version` as loose
 * columns, and the block could be pieced together from them when the object
 * is missing — it is not, on purpose: an API from before Phase 3 answers
 * without the object, and the honest rendering of that is "not available",
 * not a partial reconstruction that looks complete.
 *
 * Two clocks, both labelled (CLAUDE.md). `sourceInsertUtc` is IFL's own
 * `Date` — the plant's wall clock labelled UTC, so it takes the same UTC-
 * pinned formatters as every production time. `ingestedAtUtc` is the raw
 * row's read_at_utc, a genuine UTC instant, so it takes the app-instant
 * formatter Setup's audit log uses. Format either with the other's helper
 * and it lands five hours out.
 */
function ProvenanceBlock({ row }: { row: RegisterRow }) {
  const p: Provenance | undefined = row.provenance;
  const L = W.readings.prov;
  const dash = '—';
  const id = (v: number | string | null | undefined) => (v == null ? dash : String(v));

  return (
    <>
      <p>{W.readings.provenanceNote}</p>
      {/* One sentence, not a column of dashes: a column of dashes reads as
          "every one of these is unknown", which is not what happened. */}
      {p == null && <p className="mut">{L.notAvailable}</p>}
      <dl className="kv">
        {p != null && (
          <>
            <dt>{L.sourceTable}</dt>
            <dd>{p.sourceTable || dash}</dd>
            <dt>{L.sourceSystem}</dt>
            <dd>{p.sourceSystem || dash}</dd>
            {/* The generation sits NEXT to the row id: since IFL's 5 Aug 2026
                rebuild the id alone names two rows, and until Phase 3 the
                label was on Setup, three screens away from the id. */}
            <dt>{L.generation}</dt>
            {/* Task B (28 Sep 2026): a plain batch name ("IFL data batch 3")
                when the server sent the pair it takes — the raw table label
                ("pack1_TP1U2 gen 4") is a debugging detail, not a reader-
                facing name. Falls back to the label for an older server. */}
            <dd>{p.epochOrdinal != null ? batchName({ ordinal: p.epochOrdinal, simulator: !!p.epochSimulator }) : (p.epochLabel ?? dash)}</dd>
            <dt>{L.sourceRow}</dt>
            <dd>{id(p.sourceRowId)}</dd>
            <dt>{L.insertedAt}</dt>
            <dd>{p.sourceInsertUtc == null ? dash : `${fmtDayLong(p.sourceInsertUtc)}, ${fmtClockSec(p.sourceInsertUtc)}`}</dd>
            <dt>{L.readAt}</dt>
            <dd>{p.ingestedAtUtc == null ? dash : fmtAppInstant(p.ingestedAtUtc)}</dd>
            <dt>{L.transform}</dt>
            <dd>{p.transformVersion == null ? dash : String(p.transformVersion)}</dd>
            <dt>{L.product}</dt>
            <dd>{describeAttribution(p.attributionMethod, p.attributionConfidence)}</dd>
            {/* The two keys that make the chain followable in the database:
                raw_id → sms_raw row, run_id → sms.sync_run. Ids, under the
                disclosure, where this file's rules allow them. */}
            <dt>{L.rawRow}</dt>
            <dd>{id(p.rawId)}</dd>
            <dt>{L.syncPass}</dt>
            <dd>{p.ingestRunId ?? dash}</dd>
            {p.nightBelongsTo != null && (
              <>
                <dt>{L.nightRule}</dt>
                <dd>{W.config.rules.nights[p.nightBelongsTo] ?? p.nightBelongsTo}</dd>
              </>
            )}
          </>
        )}
        {/* Two facts that were here before Phase 3 and stay: what the plant's
            own Shift column said, and the production day this system filed
            the reading under. */}
        <dt>{L.plantShift}</dt>
        <dd>{row.shift_code_legacy ?? dash}</dd>
        <dt>{L.productionDay}</dt>
        <dd>{String(row.shift_date).slice(0, 10)}</dd>
      </dl>
    </>
  );
}

function describeMiss(byG: number): string {
  // A miss is never zero — the server's outsideByG is 0 only when inside, and
  // this is only called when it is not — so a magnitude under half a gram
  // must not round to "0 g under the lower limit", which reads as no miss.
  const magnitude = Math.abs(byG);
  const g = magnitude < 1 ? `${magnitude.toFixed(1)}${String.fromCharCode(0xa0)}g` : fmtG(magnitude);
  return byG < 0 ? `${g} under the lower limit` : `${g} over the upper limit`;
}

/**
 * How many cones were weighed between the previous sack and this one.
 *
 * Two requests rather than a join: the register already answers both questions
 * and this runs once, when somebody opens a sheet. If no earlier sack exists
 * the answer is simply not shown, rather than silently substituting a window
 * of arbitrary length and presenting it as the same fact.
 *
 * Task B (28 Sep 2026): both requests carry `batch=epoch:<this sack's own
 * epochId>` — the shape `resolveGenerationScope`'s `opts.key` exists for.
 * Without it, `?type=sack&tsTo=…` with no `from`/`to` resolves the register's
 * OWN 'auto' default over an unbounded window, which need not be the same
 * generation the sack on screen belongs to; the "cones since the previous
 * sack" count would then silently mix two source generations, exactly the
 * pooling this whole task closes everywhere else. Scoping both calls to the
 * open sack's own generation keeps "the previous sack" and "the cones
 * between them" describing the same physical table.
 */
async function conesSincePreviousSack(sackTs: string, epochId: number | null): Promise<{ cones: number; sinceUtc: string } | null> {
  const batch = epochId != null ? `epoch:${epochId}` : undefined;
  const prev = await getEvents({ type: 'sack', tsTo: sackTs, pageSize: 2, sort: 'time', dir: 'desc', batch });
  const previous = prev.data.rows.find((r) => r.production_ts_utc < sackTs);
  if (!previous) return null;
  const cones = await getEvents({
    type: 'cone',
    tsFrom: previous.production_ts_utc,
    tsTo: sackTs,
    pageSize: 1,
    batch,
  });
  return { cones: cones.data.total, sinceUtc: previous.production_ts_utc };
}
