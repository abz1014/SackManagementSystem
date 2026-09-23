/**
 * What each machine is running — roadmap Phase 4 item 4 (14 Sep 2026).
 *
 * Since IFL's 2026-08-05 rebuild every cone carries its MaterialId, and up to
 * six materials run at once on different machines; yet no screen said which
 * product was on which machine. This answers it from the readings alone:
 * per active station, the material of its NEWEST cone inside a two-hour
 * window, how many cones it weighed in that window, and since when it has
 * been on that material.
 *
 * TWO RULES FROM THE LIVE REHEARSAL (CLAUDE.md, 2 Sep 2026):
 *
 *  1. The window is anchored on the newest reading on record, never on the
 *     clock. IFL's acquisition layer writes a cone about 18 minutes after it
 *     is weighed, so "the last two hours" measured from `now` would drop the
 *     freshest quarter-hour on a healthy line and, under replay (`?at=`),
 *     would be measured from the wrong day entirely. `asOfMs` caps the
 *     window for a replay; without it the newest reading is the anchor.
 *  2. "Since when" is the earliest cone in the window that carries the SAME
 *     material at that station — the start of the current run as far as
 *     this window can see. A run older than the window reports the window's
 *     start and `sinceIsWindowStart: true`, so the screen says "for at least
 *     2 h" rather than inventing a changeover time.
 *
 * A station with no cone in the window is listed as quiet with no product —
 * never with the product it was running yesterday.
 *
 * ONE SOURCE GENERATION (23 Sep 2026, D-11, owner's decision). The anchor
 * above is `MAX(production_ts_utc_ms)` over the WHOLE table by design — rule
 * 1, and `b91f7d5` added the sentences on screen that name the window it
 * produces. That design is unchanged; what changed is that the table it takes
 * the maximum over is now ONE generation, the newest real one, so the anchor
 * is the newest reading in the data this screen claims to describe. Those
 * sentences stay true because `asOfUtc` / `windowStartUtc` still report the
 * window actually queried, and `generation` now says which generation it is a
 * window into.
 *
 * Measured on the dev sidecar, 23 Sep 2026. Unscoped, the anchor landed on
 * 2026-09-22 — a simulator instant — and the grid reported 14 stations
 * running on 603 cones, none of which were IFL's. Scoped: anchor 2026-09-07
 * 12:00, 8 stations, 347 cones. Even AT the same anchor the pooled grid
 * counted six concurrent materials where IFL's own generation has four, so
 * `materialsRunning` — the figure Product › Running leads with — was
 * inflated by two products that were running in a different physical table.
 */
import type { ConnectionPool } from 'mssql';
import mssql from 'mssql';
import { epochFragment, noteOf } from './generation.js';
import { findNewerElsewhere, resolveLiveScope, type LiveGenerationNote } from './live.js';

export const RUNNING_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface MachineRunning {
  station: number;
  stationName: string | null;
  machineName: string | null;
  /** null when quiet. */
  materialId: number | null;
  productName: string | null;
  /** Cones this station weighed in the window (any material). */
  cones: number;
  /** Cones in the window on the current material. */
  conesOnMaterial: number;
  /** Newest reading at this station in the window; null when quiet. Plant clock labelled UTC. */
  newestUtc: string | null;
  /** Earliest reading on the current material inside the window. */
  sinceUtc: string | null;
  sinceIsWindowStart: boolean;
  quiet: boolean;
}

export interface MachinesRunningData {
  /** The instant the window ends: the newest reading (or the replay cap). Null with no readings. */
  asOfUtc: string | null;
  windowMs: number;
  windowStartUtc: string | null;
  machines: MachineRunning[];
  /** Distinct materials running across the active stations. */
  materialsRunning: number;
  /**
   * Which source generation the anchor and the window belong to, and the
   * newest reading on record outside it. Always set — a consumer must read a
   * missing value as "not stated", never as "nothing was excluded".
   */
  generation: LiveGenerationNote;
}

export async function getMachinesRunning(
  pool: ConnectionPool,
  lineId: number,
  opts: { asOfMs?: number | null; windowMs?: number } = {},
): Promise<MachinesRunningData> {
  const windowMs = opts.windowMs ?? RUNNING_WINDOW_MS;

  const scope = await resolveLiveScope(pool, lineId);
  const coneF = epochFragment(scope, 'cone_event');
  const andCone = coneF.sql ? ` AND ${coneF.sql}` : '';
  const bindCone = (req: mssql.Request) => {
    for (const p of coneF.params) req.input(p.name, mssql.Int, p.id);
    return req;
  };
  const emptyNewer = {
    newerElsewhereUtc: null,
    newerElsewhereSourceDb: null,
    newerElsewhereLabel: null,
    newerElsewhereSimulator: false,
  };

  // 1. The anchor: the newest production instant on record (capped for replay).
  const anchorReq = bindCone(pool.request().input('line', mssql.Int, lineId));
  if (opts.asOfMs != null) anchorReq.input('asOf', mssql.BigInt, opts.asOfMs);
  const anchor = await anchorReq.query<{ ms: string | number | null }>(
    // RT-021 (23 Sep 2026 red-team audit): a vendor clock-fault row
    // (production_ts_utc_ms = 0, the 1969-12-31 sentinel — CLAUDE.md's
    // "Known constraints") sits in the currently-live generation and used
    // to win this MAX() whenever asOfMs landed before the generation's real
    // data starts. `> 0` is a literal, not a bound parameter, so this stays
    // the query's own floor rather than a period bound (never `@start`) —
    // the anchor is still "the newest reading in the WHOLE table", now
    // minus the one row that is not a real reading at all.
    `SELECT MAX(production_ts_utc_ms) AS ms FROM sms.cone_event
      WHERE line_id = @line AND production_ts_utc_ms > 0 ${opts.asOfMs != null ? 'AND production_ts_utc_ms <= @asOf' : ''}${andCone}`,
  );
  const asOfMs = anchor.recordset[0]?.ms == null ? null : Number(anchor.recordset[0]!.ms);

  // 2. The roster: every active station, with its name and its machine's.
  const roster = await pool
    .request()
    .input('line', mssql.Int, lineId)
    .query<{ station_id: number; name: string | null; machine_name: string | null; is_active: boolean | null }>(
      `SELECT s.station_id, s.name, m.name AS machine_name, s.is_active
         FROM sms.station s
         LEFT JOIN sms.machine m ON m.machine_id = s.machine_id
        WHERE s.line_id = @line
        ORDER BY s.station_id`,
    );
  const stations = roster.recordset.filter((r) => r.is_active == null || Boolean(r.is_active));

  const machines: MachineRunning[] = stations.map((r) => ({
    station: Number(r.station_id),
    stationName: r.name,
    machineName: r.machine_name,
    materialId: null,
    productName: null,
    cones: 0,
    conesOnMaterial: 0,
    newestUtc: null,
    sinceUtc: null,
    sinceIsWindowStart: false,
    quiet: true,
  }));

  if (asOfMs == null) {
    return {
      asOfUtc: null,
      windowMs,
      windowStartUtc: null,
      machines,
      materialsRunning: 0,
      generation: { ...noteOf(scope), ...emptyNewer },
    };
  }
  const startMs = asOfMs - windowMs;

  // 3. Per station in the window: the newest cone's material, the count, and
  //    the current run on that material — the cones on it since the LAST cone
  //    on any other material, so an A-B-A sequence reports the second A run,
  //    not the first. No other material in the window means the run may
  //    predate it: `since_is_window_start` says so.
  const r = await bindCone(
    pool
      .request()
      .input('line', mssql.Int, lineId)
      .input('start', mssql.BigInt, startMs)
      .input('end', mssql.BigInt, asOfMs),
  )
    .query<{
      st: number; material_id: number | null; product_name: string | null;
      cones: number; on_material: number; newest_ms: string | number; since_ms: string | number | null;
      since_is_window_start: number;
    }>(
      `WITH w AS (
         SELECT source_station, material_id, production_ts_utc_ms,
                ROW_NUMBER() OVER (PARTITION BY source_station ORDER BY production_ts_utc_ms DESC, cone_event_id DESC) AS rn
           FROM sms.cone_event
          WHERE line_id = @line AND source_station IS NOT NULL
            AND production_ts_utc_ms > @start AND production_ts_utc_ms <= @end${andCone}
       ),
       newest AS (SELECT source_station, material_id, production_ts_utc_ms AS newest_ms FROM w WHERE rn = 1),
       tagged AS (
         SELECT w.source_station, w.production_ts_utc_ms,
                CASE WHEN ISNULL(w.material_id, -1) = ISNULL(n.material_id, -1) THEN 1 ELSE 0 END AS same
           FROM w JOIN newest n ON n.source_station = w.source_station
       ),
       totals AS (
         SELECT source_station, COUNT(*) AS cones,
                MAX(CASE WHEN same = 0 THEN production_ts_utc_ms END) AS last_other_ms
           FROM tagged GROUP BY source_station
       ),
       run AS (
         SELECT t.source_station, COUNT(*) AS on_material, MIN(t.production_ts_utc_ms) AS since_ms
           FROM tagged t JOIN totals x ON x.source_station = t.source_station
          WHERE t.same = 1 AND t.production_ts_utc_ms > ISNULL(x.last_other_ms, -1)
          GROUP BY t.source_station
       )
       SELECT n.source_station AS st, n.material_id, COALESCE(p.description, p.lot_code) AS product_name,
              x.cones, r.on_material, n.newest_ms, r.since_ms,
              CASE WHEN x.last_other_ms IS NULL THEN 1 ELSE 0 END AS since_is_window_start
         FROM newest n
         JOIN totals x ON x.source_station = n.source_station
         JOIN run r ON r.source_station = n.source_station
         LEFT JOIN sms.product p ON p.product_id = n.material_id
        ORDER BY n.source_station`,
    );

  const byStation = new Map(machines.map((m) => [m.station, m]));
  for (const row of r.recordset) {
    const st = Number(row.st);
    let m = byStation.get(st);
    if (!m) {
      // A reading from a station Setup does not list: shown, so the screen
      // never hides a running machine, and the DQ finding names it.
      m = {
        station: st, stationName: null, machineName: null, materialId: null, productName: null,
        cones: 0, conesOnMaterial: 0, newestUtc: null, sinceUtc: null, sinceIsWindowStart: false, quiet: true,
      };
      machines.push(m);
      byStation.set(st, m);
    }
    const sinceMs = row.since_ms == null ? null : Number(row.since_ms);
    m.materialId = row.material_id == null ? null : Number(row.material_id);
    m.productName = row.product_name ?? (m.materialId != null ? `Product ${m.materialId}` : null);
    m.cones = Number(row.cones);
    m.conesOnMaterial = Number(row.on_material);
    m.newestUtc = new Date(Number(row.newest_ms)).toISOString();
    m.sinceUtc = sinceMs == null ? null : new Date(sinceMs).toISOString();
    m.sinceIsWindowStart = Number(row.since_is_window_start) === 1;
    m.quiet = false;
  }
  machines.sort((a, b) => a.station - b.station);

  const materials = new Set(machines.filter((m) => !m.quiet && m.materialId != null).map((m) => m.materialId));
  // Why the grid is quiet, when it is: the newest reading anywhere on record
  // that this generation does not hold. Capped at the replay instant when one
  // is in force, so a replay does not advertise data from after the moment
  // being replayed.
  const newer = scope.spansGenerations
    ? await findNewerElsewhere(pool, lineId, asOfMs, opts.asOfMs ?? Number.MAX_SAFE_INTEGER)
    : emptyNewer;
  return {
    asOfUtc: new Date(asOfMs).toISOString(),
    windowMs,
    windowStartUtc: new Date(startMs).toISOString(),
    machines,
    materialsRunning: materials.size,
    generation: { ...noteOf(scope), ...newer },
  };
}
