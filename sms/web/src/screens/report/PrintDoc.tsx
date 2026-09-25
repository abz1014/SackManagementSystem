/**
 * The printed report DOCUMENT — executive summary at the top, notes at the
 * end (25 Sep 2026, owner: "it's just generating numbers, not a proper
 * report"). Print-only (`.print-only`): the on-screen report is unchanged.
 *
 * Everything here is derived from the report payload already on the page —
 * no second fetch, no figure the screen does not also hold. The assessment
 * paragraph states facts and coverage only. It never says which way to
 * adjust a station (NO OVER-CLAIMING: weighing data cannot tell a heavy
 * scale from heavy cones), and never compares a mean to a target as one
 * "X g below" judgement; the two are stated side by side.
 */
import { W } from '../../lib/words';
import { fmtInt, fmtKg, fmtSpan } from '../../lib/fmt';
import type { KpiRow, ReportHeader, ReportResponse, ReportType, ReportData } from '../../api';
import { fmtG1, fmtPct, fmtSignedG } from './shared';

export interface Tile {
  label: string;
  value: string;
  unit?: string;
  note?: string | null;
  attn?: boolean;
}

interface Summary {
  tiles: Tile[];
  sentences: string[];
  coverage: ReportData['coverage'] | null;
  weightCaveat: boolean;
  notes: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
const kg = (n: number) => `${fmtInt(Math.round(n))}`;

/** Pure: the tiles and the verdict sentences for one report. Exported for tests. */
export function summarise(type: ReportType, data: ReportResponse<ReportType>): Summary {
  const out: Summary = { tiles: [], sentences: [], coverage: null, weightCaveat: false, notes: [] };
  switch (type) {
    case 'daily': {
      const d = (data as ReportResponse<'daily'>).report;
      const t = d.totals;
      out.coverage = d.coverage;
      out.tiles = [
        { label: 'Cones weighed', value: fmtInt(t.cones), note: t.conesInRangePct != null ? `${fmtPct(t.conesInRangePct)} in the scale’s range` : null },
        { label: 'Sacks packed', value: fmtInt(t.sacks), note: t.avgSackKg != null ? `${fmtKg(t.avgSackKg)} average sack` : null },
        { label: 'Sack weight', value: kg(t.sackWeightKg), unit: 'kg', note: t.conesPerSack != null ? `≈ ${t.conesPerSack} cones per sack` : null },
        { label: 'Rejected at inspection', value: fmtInt(d.rejectPopulations.atInspection), note: t.rejectRatePct != null ? `${fmtPct(t.rejectRatePct)} reject rate` : null },
      ];
      if (d.downtime) {
        out.tiles.push({ label: 'Time lost', value: fmtSpan(d.downtime.stoppedSeconds), note: plural(d.downtime.stoppageCount, 'stoppage') });
      }
      if (t.cones > 0) {
        out.sentences.push(
          `The line weighed ${fmtInt(t.cones)} cones and packed ${plural(t.sacks, 'sack')} totalling ${kg(t.sackWeightKg)} kg.`,
        );
        if (t.rejectRatePct != null) out.sentences.push(`${fmtInt(d.rejectPopulations.atInspection)} cones were rejected at inspection, a reject rate of ${fmtPct(t.rejectRatePct)}; the scale rejected ${fmtInt(d.rejectPopulations.byScale)}.`);
        const best = [...d.byShift].filter((s) => s.cones > 0).sort((a, b) => b.cones - a.cones)[0];
        if (best && d.byShift.filter((s) => s.cones > 0).length > 1) out.sentences.push(`The ${best.group} shift weighed the most cones (${fmtInt(best.cones)}).`);
        if (d.downtime) out.sentences.push(`Gaps between cones longer than the stop threshold added up to ${fmtSpan(d.downtime.stoppedSeconds)} over ${plural(d.downtime.stoppageCount, 'stoppage')}.`);
      }
      break;
    }
    case 'shift': {
      const d = (data as ReportResponse<'shift'>).report;
      out.coverage = d.shifts[0]?.coverage ?? null;
      for (const s of d.shifts) {
        out.tiles.push({
          label: `${W.shiftName[s.shift]} shift`,
          value: fmtInt(s.totals.cones),
          unit: 'cones',
          note: `${plural(s.totals.sacks, 'sack')} · ${fmtPct(s.totals.rejectRatePct)} rejected`,
        });
      }
      const worked = d.shifts.filter((s) => s.totals.cones > 0);
      if (worked.length > 0) {
        const total = worked.reduce((a, s) => a + s.totals.cones, 0);
        out.sentences.push(`Across ${plural(worked.length, 'shift')} with readings the line weighed ${fmtInt(total)} cones.`);
        const hi = [...worked].sort((a, b) => b.totals.cones - a.totals.cones)[0]!;
        if (worked.length > 1) out.sentences.push(`${W.shiftName[hi.shift]} weighed the most (${fmtInt(hi.totals.cones)}).`);
      }
      if (d.shiftCheck && d.shiftCheck.mismatched > 0) {
        out.notes.push(`Shift is recomputed from production time: ${fmtInt(d.shiftCheck.mismatched)} of ${fmtInt(d.shiftCheck.compared)} readings carry a different stored shift in IFL’s data.`);
      }
      break;
    }
    case 'product': {
      const d = (data as ReportResponse<'product'>).report;
      const cones = d.rows.reduce((a, r) => a + r.cones, 0);
      const top = [...d.rows].sort((a, b) => b.cones - a.cones)[0];
      out.tiles = [
        { label: 'Products run', value: fmtInt(d.rows.length) },
        { label: 'Cones attributed', value: fmtInt(cones) },
        { label: 'Largest product', value: top ? top.productLabel : '—', note: top ? `${fmtInt(top.cones)} cones` : null },
        { label: 'Without a product', value: fmtInt(d.unattributed.cones), unit: 'cones', note: 'readings from before products were recorded', attn: d.unattributed.cones > 0 },
      ];
      if (d.rows.length > 0) out.sentences.push(`${plural(d.rows.length, 'product')} ran in the period, accounting for ${fmtInt(cones)} cones.`);
      if (top) out.sentences.push(`${top.productLabel} was the largest, with ${fmtInt(top.cones)} cones.`);
      if (d.unattributed.cones > 0) out.sentences.push(`${fmtInt(d.unattributed.cones)} cones carry no product and are not attributed to any.`);
      out.weightCaveat = true;
      break;
    }
    case 'station': {
      const d = (data as ReportResponse<'station'>).report;
      const flagged = d.rows.filter((r) => r.flagged).length;
      out.tiles = [
        { label: 'Stations reporting', value: fmtInt(d.rows.length) },
        { label: 'Line mean', value: fmtG1(d.lineMeanG), note: d.targetG != null ? `target ${fmtG1(d.targetG)}` : 'no target in force' },
        { label: 'Line reject rate', value: fmtPct(d.lineRejectRatePct) },
        { label: 'Flagged for drift', value: fmtInt(flagged), unit: flagged === 1 ? 'station' : 'stations', attn: flagged > 0 },
      ];
      out.sentences.push(...stationSentences(d.rows.map((r) => ({ station: r.station, vsLineG: r.vsLineG, flagged: r.flagged })), d.lineMeanG, d.targetG));
      out.weightCaveat = true;
      break;
    }
    case 'reject': {
      const d = (data as ReportResponse<'reject'>).report;
      const top = d.reasons[0];
      const ooc = d.trend.filter((p) => p.outOfControl).length;
      out.tiles = [
        { label: 'Rejects', value: fmtInt(d.total) },
        { label: 'Average reject rate', value: fmtPct(d.pBarPct), note: 'over cones plus rejects' },
        { label: 'Top reason', value: top ? top.displayLabel : '—', note: top ? `${fmtInt(top.count)} · ${fmtPct(top.pct)} of rejects` : null },
        { label: 'Days outside control limits', value: fmtInt(ooc), unit: `of ${d.trend.length}`, attn: ooc > 0 },
      ];
      if (d.total > 0) {
        out.sentences.push(`${fmtInt(d.total)} cones were rejected${d.pBarPct != null ? `, an average rate of ${fmtPct(d.pBarPct)}` : ''}.`);
        if (top) out.sentences.push(`The most frequent reason was ${top.displayLabel} (${fmtPct(top.pct)} of rejects).`);
        const top3 = d.reasons.slice(0, 3);
        if (top3.length === 3) out.sentences.push(`The top three reasons account for ${fmtPct(top3[2]!.cumulativePct)} of all rejects.`);
        out.sentences.push(ooc > 0 ? `${plural(ooc, 'day')} fell outside the control limits.` : 'No day fell outside the control limits.');
      }
      break;
    }
    case 'cone-weight': {
      const d = (data as ReportResponse<'cone-weight'>).report;
      const flagged = d.byStation.filter((s) => s.flagged).length;
      out.tiles = [
        { label: 'Cones weighed', value: fmtInt(d.weighed), note: d.implausible > 0 ? `${fmtInt(d.implausible)} implausible readings excluded` : null },
        { label: 'Mean weight', value: fmtG1(d.meanG), note: `median ${fmtG1(d.medianG)}` },
        { label: 'Target in force', value: fmtG1(d.target.setpointG), note: d.target.label },
        { label: 'Spread (SD)', value: fmtG1(d.sdG), note: `range ${fmtG1(d.minG)} – ${fmtG1(d.maxG)}` },
        { label: 'Stations flagged', value: fmtInt(flagged), attn: flagged > 0 },
      ];
      if (d.weighed > 0) out.sentences.push(`${fmtInt(d.weighed)} cones were weighed, with a mean of ${fmtG1(d.meanG)} and a standard deviation of ${fmtG1(d.sdG)}.`);
      if (d.target.setpointG != null) out.sentences.push(`The target in force at the end of the period was ${fmtG1(d.target.setpointG)}${d.target.label ? ` (${d.target.label})` : ''}.`);
      out.sentences.push(...stationSentences(d.byStation.map((s) => ({ station: s.station, vsLineG: s.vsLineG, flagged: s.flagged })), null, null));
      out.weightCaveat = true;
      break;
    }
    case 'sack': {
      const d = (data as ReportResponse<'sack'>).report;
      const t = d.totals;
      out.tiles = [
        { label: 'Sacks weighed', value: fmtInt(t.sacks) },
        { label: 'Sack weight', value: kg(t.sackWeightKg), unit: 'kg', note: d.weightBasis },
        { label: 'Average sack', value: fmtKg(t.avgSackKg) },
        { label: 'In the scale’s range', value: fmtPct(d.inRangePct), note: `${fmtInt(d.rejectedByScale)} rejected by the scale`, attn: d.rejectedByScale > 0 },
      ];
      if (t.sacks > 0) out.sentences.push(`${plural(t.sacks, 'sack')} were weighed, ${kg(t.sackWeightKg)} kg in total, averaging ${fmtKg(t.avgSackKg)}.`);
      if (d.inRangePct != null) out.sentences.push(`${fmtPct(d.inRangePct)} were within the scale’s range; ${fmtInt(d.rejectedByScale)} were rejected by it.`);
      out.notes.push(d.caveats.machine, d.caveats.conesPerSack);
      break;
    }
    case 'calibration': {
      const d = (data as ReportResponse<'calibration'>).report;
      out.tiles = [
        { label: 'Stations reporting', value: fmtInt(d.stations.length) },
        { label: 'Line mean', value: fmtG1(d.lineMeanG) },
        { label: 'Target in force', value: fmtG1(d.targetG), note: d.productLabel },
        { label: 'Flagged for drift', value: d.flaggedStationCount != null ? fmtInt(d.flaggedStationCount) : '—', unit: 'stations', attn: (d.flaggedStationCount ?? 0) > 0 },
        { label: 'Adjustments logged', value: fmtInt(d.adjustments.length) },
      ];
      out.sentences.push(...stationSentences(d.stations.map((s) => ({ station: s.station, vsLineG: s.vsLineG, flagged: s.flagged })), d.lineMeanG, d.targetG));
      if (d.flaggedStationCount === 0) out.sentences.push('No station met the drift rule, so no calibration action is indicated by this data.');
      else if (d.flaggedStationCount) out.sentences.push(`${plural(d.flaggedStationCount, 'station')} met the drift rule and should be checked.`);
      out.sentences.push(d.adjustments.length === 0 ? 'No calibration adjustments were logged in the period.' : `${plural(d.adjustments.length, 'adjustment')} were logged in the period.`);
      out.weightCaveat = true;
      break;
    }
    case 'management-summary': {
      const d = (data as ReportResponse<'management-summary'>).report;
      out.coverage = d.coverage.current;
      const k = (key: string) => d.kpis.find((x) => x.key === key);
      // A headline delta is shown only when the previous period holds
      // readings on a similar share of its days: a rate over 1 day of 34
      // printed as "−95 pts" beside a month is a coverage gap, not a change.
      const share = (c: ReportData['coverage']) => (c.daysInPeriod > 0 ? c.daysWithData / c.daysInPeriod : 0);
      const cur = share(d.coverage.current);
      const pri = share(d.coverage.prior);
      const priorOk = cur > 0 && pri >= cur * 0.8;
      const priorNote = `previous period: readings on ${d.coverage.prior.daysWithData} of ${d.coverage.prior.daysInPeriod} days`;
      for (const key of ['cones_weighed', 'sacks_weighed', 'sack_weight_kg', 'inspection_reject_rate_pct', 'mean_cone_weight_g']) {
        const row = k(key);
        if (row) out.tiles.push(priorOk ? kpiTile(row) : { ...kpiTile(row), note: priorNote });
      }
      const v = d.verdict;
      if (d.coverage.current.daysWithData > 0) {
        out.sentences.push(`The line weighed ${fmtInt(v.cones)} cones and packed ${plural(v.sacks, 'sack')} totalling ${kg(v.sackWeightKg)} kg.`);
        const cones = k('cones_weighed');
        if (!priorOk) {
          out.sentences.push(`The previous period of the same length holds readings on only ${d.coverage.prior.daysWithData} of its ${d.coverage.prior.daysInPeriod} days, so no change against it is stated.`);
        } else if (cones?.comparable && cones.delta?.pct != null) {
          out.sentences.push(`That is ${fmtPct(Math.abs(cones.delta.pct))} ${cones.delta.pct >= 0 ? 'more' : 'fewer'} cones than the previous period of the same length.`);
        } else if (cones && !cones.comparable) {
          out.sentences.push('The previous period is not directly comparable (it holds a different amount of data), so no change is stated.');
        }
        const rr = k('inspection_reject_rate_pct');
        if (rr?.current != null) out.sentences.push(`The inspection reject rate was ${fmtPct(rr.current)}.`);
        const sf = k('stations_flagged');
        if (sf?.current != null) out.sentences.push(sf.current === 0 ? 'No station was flagged for drift.' : `${plural(sf.current, 'station')} were flagged for drift.`);
      }
      out.weightCaveat = true;
      break;
    }
    case 'machine-product': {
      const d = (data as ReportResponse<'machine-product'>).report;
      const within = d.changes.filter((c) => c.kind === 'within_shift').length;
      out.tiles = [
        { label: 'Machines', value: fmtInt(d.rows.length) },
        { label: 'Products', value: fmtInt(d.products.length) },
        { label: 'Shifts covered', value: fmtInt(d.columns.length) },
        { label: 'Product changes', value: fmtInt(d.changes.length), note: `${fmtInt(within)} during a shift` },
      ];
      if (d.rows.length > 0) out.sentences.push(`${plural(d.rows.length, 'machine')} ran ${plural(d.products.length, 'product')} across ${plural(d.columns.length, 'shift')}.`);
      out.sentences.push(d.changes.length === 0 ? 'No product changeover was recorded.' : `${plural(d.changes.length, 'changeover')} were recorded, ${fmtInt(within)} of them part-way through a shift.`);
      if (d.conesWithoutStation > 0) out.notes.push(`${fmtInt(d.conesWithoutStation)} cones carry no station and are not placed on any machine.`);
      break;
    }
  }
  return out;
}

function kpiTile(k: KpiRow): Tile {
  const unit = k.unit === '%' ? '' : k.unit === 'seconds' ? '' : k.unit;
  const value = k.current == null ? '—' : k.unit === '%' ? fmtPct(k.current) : k.unit === 'g' ? fmtG1(k.current) : k.unit === 'seconds' ? fmtSpan(k.current) : fmtInt(Math.round(k.current));
  let note: string | null = null;
  if (k.comparable && k.delta) {
    const sign = k.delta.abs > 0 ? '+' : k.delta.abs < 0 ? '−' : '±';
    const abs = Math.abs(k.delta.abs);
    const absTxt = k.unit === '%' ? `${abs.toFixed(1)} pts` : k.unit === 'g' ? `${abs.toFixed(1)} g` : fmtInt(Math.round(abs));
    note = `${sign}${absTxt} vs previous period`;
  } else if (!k.comparable) note = 'previous period not comparable';
  return { label: k.label, value, unit: k.unit === 'g' ? undefined : unit || undefined, note };
}

/** Station facts in words: spread against the line, and the flag. Never a direction to adjust. */
function stationSentences(rows: { station: number; vsLineG: number | null; flagged: boolean }[], lineMeanG: number | null, targetG: number | null): string[] {
  const s: string[] = [];
  const withBias = rows.filter((r) => r.vsLineG != null);
  if (withBias.length === 0) return s;
  if (lineMeanG != null) {
    s.push(targetG != null
      ? `Across ${plural(withBias.length, 'station')} the line mean was ${fmtG1(lineMeanG)}; the target in force was ${fmtG1(targetG)}.`
      : `Across ${plural(withBias.length, 'station')} the line mean was ${fmtG1(lineMeanG)}; no target was in force.`);
  }
  const hi = withBias.reduce((a, r) => ((r.vsLineG as number) > (a.vsLineG as number) ? r : a));
  const lo = withBias.reduce((a, r) => ((r.vsLineG as number) < (a.vsLineG as number) ? r : a));
  s.push(`Station means ranged from ${fmtSignedG(lo.vsLineG)} (station ${lo.station}) to ${fmtSignedG(hi.vsLineG)} (station ${hi.station}) against the line.`);
  return s;
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="pd-tiles" data-n={tiles.length}>
      {tiles.map((t) => (
        <div key={t.label} className={`pd-tile${t.attn ? ' attn' : ''}`}>
          <span className="pd-k">{t.label}</span>
          <span className="pd-v">{t.value}{t.unit ? <small> {t.unit}</small> : null}</span>
          {t.note ? <span className="pd-n">{t.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Print-only: headline tiles and a plain-English assessment, before the detail. */
/**
 * A payload with a field missing (the fuzz tests strip them) must never take
 * the on-screen report down with it: this summary is print-only decoration
 * over data the sections below already state, so on any failure it is
 * simply left out rather than printing a guess.
 */
function safeSummarise(type: ReportType, data: ReportResponse<ReportType>): Summary | null {
  try {
    return summarise(type, data);
  } catch {
    return null;
  }
}

export function ExecSummary({ type, data }: { type: ReportType; data: ReportResponse<ReportType> }) {
  const s = safeSummarise(type, data);
  if (!s) return null;
  const cov = s.coverage;
  const empty = cov != null && cov.daysWithData === 0;
  return (
    <section className="print-only pd-summary">
      <h2 className="pd-h">{W.printDoc.summary}</h2>
      {empty ? (
        <p className="pd-verdict">{W.printDoc.noData}</p>
      ) : (
        <>
          <Tiles tiles={s.tiles} />
          <div className="pd-assess">
            <span className="pd-k">{W.printDoc.assessment}</span>
            <p className="pd-verdict">
              {[...s.sentences, cov ? W.printDoc.coverage(cov.daysWithData, cov.daysInPeriod) : null].filter(Boolean).join(' ')}
            </p>
          </div>
        </>
      )}
      <h2 className="pd-h pd-detail">{W.printDoc.detail}</h2>
    </section>
  );
}

/** Print-only: the closing notes — the report's own method note, caveats, definitions status, provenance. */
export function PrintNotes({ type, data, header }: { type: ReportType; data: ReportResponse<ReportType>; header: ReportHeader }) {
  const s = safeSummarise(type, data);
  const items = [
    ...(s?.notes ?? []),
    ...(s?.weightCaveat ? [W.printDoc.weightNote] : []),
    W.printDoc.clockNote,
    W.printDoc.approvalNote,
    W.printDoc.sourceNote,
    ...(header.spansGenerations
      ? [W.printDoc.generationNote(header.sourceGeneration ?? 'unknown', `${fmtInt(header.otherGenerationExcluded?.count ?? 0)} readings${header.otherGenerationExcluded?.percent != null ? ` (${header.otherGenerationExcluded.percent}%)` : ''}`)]
      : []),
  ];
  return (
    <section className="print-only pd-notes">
      <h2 className="pd-h">{W.printDoc.notes}</h2>
      <ol>
        {[...new Set(items)].map((t) => <li key={t}>{t}</li>)}
      </ol>
      <p className="pd-conf">{W.printDoc.confidential}</p>
    </section>
  );
}
