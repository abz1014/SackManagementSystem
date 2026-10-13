/**
 * The reads behind a record sheet (cone, sack, inspection fail): the detail row, the product in force at the
 * reading's own time, the station names and, for a sack, the cones counted since the previous sack.
 * Each is its own part, so a failure names what is missing instead of blanking the sheet (a failed fetch is never zero).
 */
import { getEventDetail, getEvents, getProductAt, getStations, type RegisterRow, type RegisterType } from '../../bridge/api';
import { useData, type DataState } from '../../data';

type ProductAt = Awaited<ReturnType<typeof getProductAt>>;
type Stations = Awaited<ReturnType<typeof getStations>>;
type Row = RegisterRow & Record<string, unknown>;

/** A request that never settles: the part stays loading until its inputs exist. */
const wait = (): Promise<never> => new Promise<never>(() => {});

export interface Around {
  cones: number;
  sinceUtc: string;
}

export const validId = (id: string): boolean => /^\d{1,15}$/.test(id);

/**
 * How many cones were weighed between the previous sack and this one. Both reads are scoped to this sack's own
 * data set (`epoch:<id>`), so "the previous sack" and "the cones between" describe the same physical table.
 * With no earlier sack the answer is null: no window of arbitrary length is substituted.
 */
export async function conesSincePreviousSack(sackTs: string, epochId: number | null): Promise<Around | null> {
  const batch = epochId !== null ? `epoch:${epochId}` : undefined;
  const prev = await getEvents({ type: 'sack', tsTo: sackTs, pageSize: 2, sort: 'time', dir: 'desc', batch });
  const previous = prev.data.rows.find((r) => r.production_ts_utc < sackTs);
  if (!previous) return null;
  const cones = await getEvents({ type: 'cone', tsFrom: previous.production_ts_utc, tsTo: sackTs, pageSize: 1, batch });
  return { cones: cones.data.total, sinceUtc: previous.production_ts_utc };
}

export interface ReadingData {
  detail: DataState<{ row: Row }>;
  product: DataState<ProductAt>;
  stations: DataState<Stations>;
  /** `around: null` is a real answer (no earlier sack); a bare null would read as still loading. */
  around: DataState<{ around: Around | null }>;
}

/** The detail row. A malformed id never reaches here (the sheet refuses it first). */
export function useReadingDetail(type: RegisterType, id: string): DataState<{ row: Row }> {
  return useData('this reading', () => getEventDetail(type, id), `reading:${type}:${id}`, { live: false });
}

/** The product in force at THIS reading's own time, judged by the server's one classification. Sacks have no product limits. */
export function useProductThen(type: RegisterType, id: string, row: Row | null): DataState<ProductAt> {
  return useData(
    'the product in force then',
    () =>
      row
        ? getProductAt(
            row.production_ts_utc,
            row.material_id ?? undefined,
            type === 'sack' ? undefined : (row.weight_g ?? undefined),
            type === 'sack' ? undefined : row.in_range,
          )
        : wait(),
    `reading-product:${type}:${id}:${row ? 'row' : 'wait'}`,
    { live: false },
  );
}

export function useReadingStations(): DataState<Stations> {
  return useData('the station list', () => getStations(), 'stations', { live: false });
}

/** Sacks only: the cones counted since the previous sack. Other kinds never ask. */
export function useConesAround(type: RegisterType, id: string, row: Row | null): DataState<{ around: Around | null }> {
  return useData<{ around: Around | null }>(
    'the cones between sacks',
    () =>
      row && type === 'sack'
        ? conesSincePreviousSack(row.production_ts_utc, row.provenance?.epochId ?? null).then((around) => ({ around }))
        : wait(),
    `reading-around:${id}:${row ? 'row' : 'wait'}`,
    { live: false },
  );
}
