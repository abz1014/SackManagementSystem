/**
 * One reading, in a sheet over whatever screen opened it.
 *
 * Replaces both the sticky detail rail and the full record page — two surfaces
 * that described the same reading, and between them leaked merge-key
 * uniqueness, transform version, source system and a data-quality collision id
 * to somebody who had asked what a cone weighed.
 *
 * WHAT IT MAY AND MAY NOT SAY:
 *  - The scale's verdict, always, named as the scale's.
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
 *    wants to know where the row came from.
 */
import { useEffect, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Details, Loading } from '../ui/bits';
import { W } from '../lib/words';
import { fmtClock, fmtDayLong, fmtG, fmtKg } from '../floor/fmt';
import {
  getEventDetail, getEvents, getProductAt, getStations, stationLabel,
  type ProductAtData, type RegisterRow, type RegisterType, type StationRow,
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
}: {
  type: RegisterType;
  id: string;
  onClose: () => void;
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
        const product = await getProductAt(row.production_ts_utc);
        if (cancelled) return;

        let around: State['around'] = null;
        if (type === 'sack') {
          around = await conesSincePreviousSack(row.production_ts_utc);
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
        <Body type={type} state={s} />
      )}
    </Sheet>
  );
}

function eyebrow(type: RegisterType, s: State): string {
  if (!s.row) return type === 'sack' ? 'Sack' : 'Cone';
  const st = s.row.source_station;
  const station = st != null ? ` · ${stationLabel(s.stations.find((x) => x.stationId === st), st)}` : '';
  return `${type === 'sack' ? 'Sack' : 'Cone'}${station} · ${W.shiftName[s.row.shift_code as 'morning'] ?? s.row.shift_code} shift`;
}

function Body({ type, state }: { type: RegisterType; state: State }) {
  const row = state.row!;
  const isSack = type === 'sack';
  const weight = isSack ? row.weight_kg : row.weight_g;
  const rejectedByScale = row.in_range === false;
  const p = state.product;
  const verdict = p?.limits && weight != null && !isSack ? judge(Number(weight), p.limits) : null;

  return (
    <>
      <div className="big">{isSack ? fmtKg(row.weight_kg) : fmtG(row.weight_g)}</div>
      <div className={rejectedByScale ? 'acc' : ''} style={{ marginTop: 8, fontWeight: 500 }}>
        {rejectedByScale ? W.rejectedByScale : W.passed}
      </div>

      {/* The product comparison — only when there was a product to compare to. */}
      {!isSack && (
        <div className="g" style={{ marginTop: 6 }}>
          {p?.product == null ? (
            W.noProductThen
          ) : p.limits == null ? (
            'The product recorded at this time carries no target weight, so there are no limits to compare against.'
          ) : verdict == null ? null : verdict.inside ? (
            `Inside the product's limits, ${p.limits.label}.`
          ) : (
            <span className="acc">
              {W.alsoOutsideProduct(p.limits.label, describeMiss(verdict.byG))}
            </span>
          )}
        </div>
      )}

      <dl className="kv" style={{ marginTop: 24 }}>
        <dt>{W.readings.weighed}</dt>
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
        <dt>{W.readings.record}</dt>
        <dd>{String(row.source_row_id)}</dd>
        {p?.product && (
          <>
            <dt>Product then</dt>
            <dd>{p.product.label}</dd>
          </>
        )}
      </dl>

      {/* Sacks only, once, with the caveat in the same sentence. */}
      {isSack && state.around && (
        <p className="mut sm" style={{ marginTop: 22 }}>
          {W.readings.aroundSack(state.around.cones)}
        </p>
      )}

      <Details summary={W.readings.provenance}>
        <p>{W.readings.provenanceNote}</p>
        <dl className="kv">
          <dt>Source row</dt>
          <dd>{String(row.source_row_id)}</dd>
          <dt>Plant-stored shift</dt>
          <dd>{row.shift_code_legacy ?? '—'}</dd>
          <dt>Production day</dt>
          <dd>{row.shift_date}</dd>
        </dl>
      </Details>
    </>
  );
}

function judge(weight: number, limits: { loG: number; hiG: number }): { inside: boolean; byG: number } {
  if (weight < limits.loG) return { inside: false, byG: Math.round((weight - limits.loG) * 100) / 100 };
  if (weight > limits.hiG) return { inside: false, byG: Math.round((weight - limits.hiG) * 100) / 100 };
  return { inside: true, byG: 0 };
}

function describeMiss(byG: number): string {
  const g = fmtG(Math.abs(byG));
  return byG < 0 ? `${g} under the lower limit` : `${g} over the upper limit`;
}

/**
 * How many cones were weighed between the previous sack and this one.
 *
 * Two requests rather than a join: the register already answers both questions
 * and this runs once, when somebody opens a sheet. If no earlier sack exists
 * the answer is simply not shown, rather than silently substituting a window
 * of arbitrary length and presenting it as the same fact.
 */
async function conesSincePreviousSack(sackTs: string): Promise<{ cones: number; sinceUtc: string } | null> {
  const prev = await getEvents({ type: 'sack', tsTo: sackTs, pageSize: 2, sort: 'time', dir: 'desc' });
  const previous = prev.data.rows.find((r) => r.production_ts_utc < sackTs);
  if (!previous) return null;
  const cones = await getEvents({
    type: 'cone',
    tsFrom: previous.production_ts_utc,
    tsTo: sackTs,
    pageSize: 1,
  });
  return { cones: cones.data.total, sinceUtc: previous.production_ts_utc };
}
