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

/**
 * The weight basis the server states a sack report under (`as_recorded` /
 * `gross` / `net`) in words for a tile note — a printed page must never carry
 * the raw code ("as_recorded"). An unknown code is printed as it came rather
 * than guessed at; absent stays absent.
 */
const BASIS_WORDS: Record<string, string> = { as_recorded: 'as the scale recorded them', gross: 'gross', net: 'net of the sack tare' };
const basisNote = (code: string | null | undefined): string | null => (code ? (BASIS_WORDS[code] ?? code) : null);

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
      // Verification 25 Sep 2026 (R4): count BOTH sides of the band and say
      // which is which — the upper side alone used to be printed as "outside
      // the control limits".
      const ooc = d.trend.filter((p) => p.outOfControl).length;
      const below = d.trend.filter((p) => p.belowLower === true).length;
      const outside = ooc + below;
      out.tiles = [
        { label: 'Rejects', value: fmtInt(d.total) },
        { label: 'Average reject rate', value: fmtPct(d.pBarPct), note: 'over cones plus rejects' },
        { label: 'Top reason', value: top ? top.displayLabel : '—', note: top ? `${fmtInt(top.count)} · ${fmtPct(top.pct)} of rejects` : null },
        { label: 'Days outside control limits', value: fmtInt(outside), unit: `of ${d.trend.length}`, note: `${fmtInt(ooc)} above · ${fmtInt(below)} below`, attn: ooc > 0 },
      ];
      if (d.total > 0) {
        out.sentences.push(`${fmtInt(d.total)} cones were rejected${d.pBarPct != null ? `, an average rate of ${fmtPct(d.pBarPct)}` : ''}.`);
        if (top) out.sentences.push(`The most frequent reason was ${top.displayLabel} (${fmtPct(top.pct)} of rejects).`);
        const top3 = d.reasons.slice(0, 3);
        if (top3.length === 3) out.sentences.push(`The top three reasons account for ${fmtPct(top3[2]!.cumulativePct)} of all rejects.`);
        out.sentences.push(
          outside === 0
            ? `No day fell outside the control limits (${plural(d.trend.length, 'day')} charted).`
            : `${fmtInt(outside)} of ${plural(d.trend.length, 'day')} fell outside the control limits: ${fmtInt(ooc)} above the upper limit (more rejects than usual) and ${fmtInt(below)} below the lower limit (fewer than usual).`,
        );
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
        { label: 'Sack weight', value: kg(t.sackWeightKg), unit: 'kg', note: basisNote(d.weightBasis) },
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
        { label: 'Flagged for drift', value: d.driftRuleCanFire === false ? '—' : d.flaggedStationCount != null ? fmtInt(d.flaggedStationCount) : '—', unit: 'stations', note: d.driftRuleCanFire === false ? 'period too short for the rule' : null, attn: (d.flaggedStationCount ?? 0) > 0 },
        { label: 'Adjustments logged', value: fmtInt(d.adjustments.length) },
      ];
      out.sentences.push(...stationSentences(d.stations.map((s) => ({ station: s.station, vsLineG: s.vsLineG, flagged: s.flagged })), d.lineMeanG, d.targetG));
      // Verification 25 Sep 2026 (C8): on a period shorter than the rule's
      // minimum run the rule cannot fire at all, so "no station flagged" is
      // a guaranteed result, not evidence.
      if (d.driftRuleCanFire === false) {
        out.sentences.push(`The period covers ${plural(d.periodDays ?? 0, 'day')}; the drift rule needs a run of at least ${plural(d.minDaysHeld, 'day')}, so it cannot flag any station over a period this short. Choose a longer period to judge drift.`);
      } else if (d.flaggedStationCount === 0) out.sentences.push('No station met the drift rule, so no calibration action is indicated by this data.');
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
    case 'shift-production': {
      const d = (data as ReportResponse<'shift-production'>).report;
      const g = d.grandTotal;
      const eff = g.efficiencyPct == null ? 'not available' : `${g.efficiencyPct.toFixed(2)}%`;
      // The labels say what the figures ARE: a cone weighed and then rejected on weight is in the total as a reject, never also as a pass.
      out.tiles = [
        { label: 'Pass (not weight-rejected)', value: fmtInt(g.pass) },
        { label: 'Rejected on weight', value: fmtInt(g.weightRejects), attn: g.weightRejects > 0 },
        { label: 'Total', value: fmtInt(g.total), note: 'pass plus rejected on weight' },
        { label: 'Efficiency', value: g.efficiencyPct == null ? '—' : `${g.efficiencyPct.toFixed(2)}%` },
      ];
      // A server that predates the kg figure omits it: no tile, never a "0 kg".
      if (typeof g.weighedKg === 'number') out.tiles.push({ label: 'Total weight', value: kg(g.weighedKg), unit: 'kg', note: d.kgBasis?.label ?? null });
      if (g.total > 0) {
        // D1 (1 Oct 2026): each cone is counted ONCE. A cone weighed and then rejected on weight is in the total as a reject, not also as a pass,
        // so the total is pass + rejected on weight; the sentence states it, and the plural follows the number ("1 was rejected", "2 were rejected").
        const weighed = typeof g.weighed === 'number' ? `${fmtInt(g.weighed)} ${g.weighed === 1 ? 'cone was' : 'cones were'} weighed. ` : '';
        out.sentences.push(`${weighed}${fmtInt(g.pass)} passed and ${fmtInt(g.weightRejects)} ${g.weightRejects === 1 ? 'was' : 'were'} rejected on weight: ${fmtInt(g.total)} in total, each cone counted once, an efficiency of ${eff}.`);
        // The scale's own in-range bit and the weight-reject records are two
        // separate records (SCHEMA.md): said once, never merged.
        if (typeof d.scaleRejectedCones === 'number') out.sentences.push(W.iflReports.shiftProduction.scaleRejected(fmtInt(d.scaleRejectedCones), fmtInt(g.weightRejects)));
        const known = (d.summary ?? []).filter((r) => r.efficiencyPct != null && r.total > 0);
        if (known.length > 1) {
          const low = known.reduce((a, b) => (b.efficiencyPct! < a.efficiencyPct! ? b : a));
          out.sentences.push(`The ${W.shiftName[low.shift].toLowerCase()} shift had the lowest efficiency, ${low.efficiencyPct!.toFixed(2)}%.`);
        }
      } else {
        out.sentences.push(W.iflReports.shiftProduction.empty);
      }
      break;
    }
    case 'rejected-cones': {
      const d = (data as ReportResponse<'rejected-cones'>).report;
      const l = d.weightRange?.line;
      // The weight range is over EVERY weighed cone on the line (plausible weights, whatever the scale decided), not over the rejected ones:
      // the tiles say so, or "Lightest" beside "Rejected cones" would read as the lightest rejected cone.
      out.tiles = [
        { label: 'Rejected on weight', value: fmtInt(d.total ?? 0), attn: (d.total ?? 0) > 0 },
        { label: 'Lightest weighed cone', value: l?.minG == null ? '—' : fmtG1(l.minG), note: 'all cones on the line' },
        { label: 'Heaviest weighed cone', value: l?.maxG == null ? '—' : fmtG1(l.maxG), note: 'all cones on the line' },
      ];
      out.sentences.push(`${plural(d.total ?? 0, 'cone')} ${d.total === 1 ? 'was' : 'were'} rejected on weight.`);
      if (l && l.n > 0 && l.minG != null && l.maxG != null) out.sentences.push(`Across all ${plural(l.n, 'weighed cone')} on the line, weights ranged from ${fmtG1(l.minG)} to ${fmtG1(l.maxG)}.`);
      break;
    }
    case 'rejected-sacks': {
      const d = (data as ReportResponse<'rejected-sacks'>).report;
      const t = d.total;
      const split = d.rejectedSplit;
      const sacks = t?.sacks ?? 0;
      const rejected = t?.rejected ?? 0;
      out.tiles = [
        { label: 'Sacks weighed', value: fmtInt(sacks) },
        { label: 'Rejected by the scale', value: fmtInt(rejected), note: t?.rejectedPct != null ? `${fmtPct(t.rejectedPct, 2)} of sacks` : null, attn: rejected > 0 },
        { label: 'Implausible weight', value: fmtInt(split?.implausible ?? 0), note: '0 kg or a fault reading' },
        { label: 'No scale verdict', value: fmtInt(t?.noFlag ?? 0), note: 'not counted as passes' },
      ];
      if (sacks === 0) {
        out.sentences.push('No sacks were weighed in this period.');
      } else {
        out.sentences.push(`The scale rejected ${fmtInt(rejected)} of ${plural(sacks, 'sack')}${t?.rejectedPct != null ? ` (${fmtPct(t.rejectedPct, 2)})` : ''}.`);
        if (rejected > 0 && split) out.sentences.push(`Of the ${fmtInt(rejected)} rejected, ${fmtInt(split.implausible)} had an implausible weight (0 kg or a fault reading) and ${fmtInt(split.plausible)} a plausible one.`);
        if (t && t.noFlag > 0) out.sentences.push(`${plural(t.noFlag, 'sack')} carried no scale verdict and ${t.noFlag === 1 ? 'is' : 'are'} not counted as passes.`);
        const all = d.passedRange?.all;
        if (all && all.sacks > 0 && all.minKg != null && all.maxKg != null) out.sentences.push(`The scale passed sacks from ${fmtKg(all.minKg)} to ${fmtKg(all.maxKg)}; that is the recorded pass range, not a tolerance.`);
      }
      break;
    }
    case 'sps-packing': {
      const d = (data as ReportResponse<'sps-packing'>).report;
      const packed = (d.totals ?? []).filter((c) => c.sacks > 0);
      const named = packed.filter((c) => c.yarnCount != null);
      // Two count-less columns: 'none' (no product on the reading) and 'unknown' (a product whose yarn count is not on record). They are different facts.
      const noProduct = packed.find((c) => c.key === 'none');
      const unknownCount = packed.find((c) => c.key === 'unknown');
      const top = [...named].sort((a, b) => b.sacks - a.sacks)[0];
      const total = d.grandTotal ?? { sacks: 0, kg: 0, avgKg: null };
      out.tiles = [
        { label: 'Sacks packed', value: fmtInt(total.sacks) },
        { label: 'Sack weight', value: kg(total.kg), unit: 'kg', note: basisNote(d.weightBasis) },
        { label: 'Yarn counts packed', value: fmtInt(named.length) },
        { label: 'Largest count', value: top ? top.label : '—', note: top ? `${plural(top.sacks, 'sack')}${top.sharePct != null ? ` · ${fmtPct(top.sharePct)}` : ''}` : null },
      ];
      if (total.sacks === 0) {
        out.sentences.push('No sacks were packed in this period.');
      } else {
        out.sentences.push(`${plural(total.sacks, 'sack')} ${total.sacks === 1 ? 'was' : 'were'} packed, ${kg(total.kg)} kg in all, across ${plural(named.length, 'yarn count')}.`);
        if (top) out.sentences.push(`${top.label} was the largest count, with ${plural(top.sacks, 'sack')}${top.sharePct != null ? ` (${fmtPct(top.sharePct)} of sacks)` : ''}.`);
        if (noProduct) out.sentences.push(`${plural(noProduct.sacks, 'sack')} ${noProduct.sacks === 1 ? 'carries' : 'carry'} no product on the reading and so ${noProduct.sacks === 1 ? 'has' : 'have'} no yarn count.`);
        if (unknownCount) out.sentences.push(`${plural(unknownCount.sacks, 'sack')} ${unknownCount.sacks === 1 ? 'has' : 'have'} a product whose yarn count is not on record.`);
        if (d.sps?.label) out.sentences.push(`Packing is stated for ${d.sps.label}.`);
      }
      break;
    }
    case 'sack-weight-range': {
      const d = (data as ReportResponse<'sack-weight-range'>).report;
      // The scale's verdict over every band, the implausible row included.
      const sum = (pick: (b: ReportResponse<'sack-weight-range'>['report']['bands'][number]) => number) => (d.bands ?? []).reduce((a, b) => a + pick(b), 0);
      const total = sum((b) => b.total.total);
      const passed = sum((b) => b.total.passed);
      const rejected = sum((b) => b.total.rejected);
      const sp = d.spreadTotal;
      const span = d.passedRange;
      out.tiles = [
        { label: 'Sacks weighed', value: fmtInt(total) },
        { label: 'Passed by the scale', value: fmtInt(passed) },
        { label: 'Rejected by the scale', value: fmtInt(rejected), attn: rejected > 0 },
        { label: 'Passed range', value: span ? `${span.minKg.toFixed(2)}–${span.maxKg.toFixed(2)}` : '—', unit: span ? 'kg' : undefined, note: 'recorded, not a tolerance' },
        { label: 'Spread (SD)', value: sp?.sdKg == null ? '—' : sp.sdKg.toFixed(2), unit: sp?.sdKg == null ? undefined : 'kg', note: sp && sp.n > 0 ? plural(sp.n, 'plausible sack') : null },
      ];
      if (total === 0) {
        out.sentences.push('No sacks were weighed in this period.');
      } else {
        out.sentences.push(`${plural(total, 'sack')} ${total === 1 ? 'was' : 'were'} weighed: ${fmtInt(passed)} passed and ${fmtInt(rejected)} ${rejected === 1 ? 'was' : 'were'} rejected by the scale.`);
        out.sentences.push(span
          ? `The scale passed sacks from ${fmtKg(span.minKg)} to ${fmtKg(span.maxKg)}; that is the recorded pass range, not a tolerance.`
          : 'The scale passed no sacks in this period.');
        if (sp && sp.n > 0 && sp.avgKg != null) out.sentences.push(`Plausible sack weights averaged ${fmtKg(sp.avgKg)}${sp.sdKg != null ? ` with a standard deviation of ${fmtKg(sp.sdKg)}` : ''}${typeof d.bandKg === 'number' ? `, grouped in ${d.bandKg} kg bands` : ''}.`);
      }
      break;
    }
    case 'sack-weight-summary': {
      const d = (data as ReportResponse<'sack-weight-summary'>).report;
      const t = d.total;
      const sacks = t?.sacks ?? 0;
      out.tiles = [
        { label: 'Sacks weighed', value: fmtInt(sacks) },
        { label: 'Sack weight', value: kg(t?.kg ?? 0), unit: 'kg', note: basisNote(d.weightBasis) },
        { label: 'Average sack', value: fmtKg(t?.avgKg), note: t && t.implausible > 0 ? `${fmtInt(t.implausible)} implausible left out` : null },
        { label: 'Rejected by the scale', value: fmtInt(t?.rejectedByScale ?? 0), attn: (t?.rejectedByScale ?? 0) > 0 },
      ];
      if (sacks === 0 || !t) {
        out.sentences.push('No sacks were weighed in this period.');
      } else {
        out.sentences.push(`${plural(sacks, 'sack')} ${sacks === 1 ? 'was' : 'were'} weighed, ${kg(t.kg)} kg in total${t.avgKg != null ? `, averaging ${fmtKg(t.avgKg)}` : ''}.`);
        if (t.minKg != null && t.maxKg != null) out.sentences.push(`Plausible sack weights ranged from ${fmtKg(t.minKg)} to ${fmtKg(t.maxKg)}${t.sdKg != null ? `, with a standard deviation of ${fmtKg(t.sdKg)}` : ''}.`);
        out.sentences.push(`${fmtInt(t.rejectedByScale)} ${t.rejectedByScale === 1 ? 'was' : 'were'} rejected by the scale.`);
        if (t.implausible > 0) out.sentences.push(W.iflReports.sackWeightSummary.excludedNote(fmtInt(t.implausible)));
      }
      break;
    }
    case 'rejected-hangers': {
      const d = (data as ReportResponse<'rejected-hangers'>).report;
      const tt = d.total;
      const f = d.flagging;
      const rows = d.hangers ?? [];
      const standing = rows.filter((h) => h.flag === 'stands_out').map((h) => h.hanger).filter((n): n is number => n != null);
      const withRejects = rows.filter((h) => h.hanger != null && h.total > 0).length;
      const total = tt?.total ?? 0;
      out.tiles = [
        { label: 'Hangers seen', value: fmtInt(f?.hangersSeen ?? rows.filter((h) => h.hanger != null).length) },
        { label: 'Rejected cones', value: fmtInt(total), attn: total > 0 },
        { label: 'Line reject rate', value: fmtPct(f?.lineRatePct ?? tt?.ratePct), note: 'over cones plus rejects' },
        { label: 'Hangers that stand out', value: fmtInt(standing.length), attn: standing.length > 0, note: f?.canFlag === false ? 'too few cones per hanger to judge' : null },
      ];
      if (total === 0) {
        out.sentences.push('No cone was rejected in this period.');
      } else {
        out.sentences.push(`${plural(total, 'cone')} ${total === 1 ? 'was' : 'were'} rejected, on ${plural(withRejects, 'hanger')}.`);
        if (f?.canFlag === true) {
          if (standing.length === 0) out.sentences.push('No hanger stands out in this period.');
          else {
            const shown = standing.slice(0, 6).join(', ');
            const more = standing.length > 6 ? ` and ${standing.length - 6} more` : '';
            out.sentences.push(`${standing.length === 1 ? 'Hanger' : 'Hangers'} ${shown}${more} ${standing.length === 1 ? 'stands' : 'stand'} out in this period; this describes the period’s counts, not the hanger itself.`);
          }
        } else if (f?.canFlag === false && f.reason) {
          out.sentences.push(f.reason);
        }
      }
      break;
    }
    case 'rejected-unknown-lifter': {
      const d = (data as ReportResponse<'rejected-unknown-lifter'>).report;
      const tt = d.total;
      // The draft definition (1 Oct 2026): "unknown" = no lifter number or no winder number recorded, nothing else.
      // A zero reason code is NOT unknown: it is counted and listed apart, because IFL has not said what a zero code means.
      const listed = d.unknownCount ?? d.listTotal ?? d.list?.length ?? 0;
      const zeroCoded = d.zeroCodeTotal ?? tt?.zeroCodeRejects ?? 0;
      const zeroed = d.zeroedClock?.rows?.length ?? 0;
      out.tiles = [
        { label: 'Rejected cones', value: fmtInt(tt?.total ?? 0) },
        { label: 'No lifter or winder recorded', value: fmtInt(listed), attn: listed > 0 },
        { label: 'Reason code zero', value: fmtInt(zeroCoded), note: 'counted apart, not “unknown”', attn: zeroCoded > 0 },
        { label: 'Zeroed-clock records', value: fmtInt(zeroed), note: 'reached by no period' },
      ];
      out.sentences.push(listed === 0
        ? W.iflReports.rejectedUnknownLifter.allHaveLifter
        : `${plural(listed, 'rejected cone')} ${listed === 1 ? 'has' : 'have'} no lifter number or no winder number recorded.`);
      if (zeroCoded > 0) out.sentences.push(`${plural(zeroCoded, 'rejected cone')} ${zeroCoded === 1 ? 'carries' : 'carry'} a zero reason code; ${zeroCoded === 1 ? 'it is' : 'they are'} counted in the table and listed apart, because IFL has not confirmed what a zero code means.`);
      if (zeroed > 0) out.sentences.push(`${plural(zeroed, 'record')} with a zeroed clock ${zeroed === 1 ? 'exists' : 'exist'} in this data batch; no period reaches ${zeroed === 1 ? 'it' : 'them'}.`);
      break;
    }
    case 'machine-product': {
      const d = (data as ReportResponse<'machine-product'>).report;
      const within = d.changes.filter((c) => c.kind === 'within_shift').length;
      // Verification 25 Sep 2026 (X1): machines that WEIGHED cones, not roster rows.
      const ran = d.machinesWeighing ?? d.rows.filter((r) => r.cones > 0).length;
      const idle = d.rows.length - ran;
      out.tiles = [
        { label: 'Machines weighing', value: fmtInt(ran), note: idle > 0 ? `${fmtInt(idle)} on the roster weighed nothing` : null },
        { label: 'Products', value: fmtInt(d.products.length) },
        { label: 'Shifts covered', value: fmtInt(d.columns.length) },
        { label: 'Product changes', value: fmtInt(d.changes.length), note: `${fmtInt(within)} during a shift` },
      ];
      if (ran > 0) out.sentences.push(`${plural(ran, 'machine')} ran ${plural(d.products.length, 'product')} across ${plural(d.columns.length, 'shift')}${idle > 0 ? `; ${plural(idle, 'machine')} on the roster weighed no cones` : ''}.`);
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

/**
 * The sentences an IFL report's SECTION already prints beside its tables, word for word — the method note every one of the eight shows
 * under its first table, the Shift-wise CTS Loop report's loop and kg-basis lines, and the rejected-cone list's "oldest on record"
 * sentence. The server composes the same sentences into `header.reportNotes` because the CSV and the workbook have no body to print them
 * in; on PAPER the body already carries them, so the closing notes must not state them a second time. Pure; exported for tests.
 */
export function printedInBody(type: ReportType, data: ReportResponse<ReportType>): string[] {
  const rep = (data?.report ?? {}) as { note?: unknown; loop?: { hangersSeen?: unknown }; kgBasis?: { label?: unknown; implausible?: unknown } | null };
  const out: string[] = [];
  if (typeof rep.note === 'string' && rep.note.trim() !== '' && IFL_PRINT_TYPES.has(type)) out.push(rep.note.trim());
  if (type === 'shift-production') {
    const S = W.iflReports.shiftProduction;
    const hangers = rep.loop?.hangersSeen;
    if (typeof hangers === 'number' && hangers > 0) out.push(S.loopLine(fmtInt(hangers), hangers === 1));
    const kgb = rep.kgBasis;
    if (kgb && typeof kgb.label === 'string' && typeof kgb.implausible === 'number') out.push(S.kgBasis(kgb.label, fmtInt(kgb.implausible)));
  }
  if (type === 'rejected-cones') out.push(W.iflReports.rejectedConesList.lowerBoundNote);
  return out;
}

/** IFL's eight reports: the ones whose sections print the report's `note` in their body. */
const IFL_PRINT_TYPES: ReadonlySet<ReportType> = new Set<ReportType>([
  'shift-production', 'rejected-sacks', 'sps-packing', 'sack-weight-range', 'sack-weight-summary', 'rejected-cones', 'rejected-hangers', 'rejected-unknown-lifter',
]);

/** Print-only: the closing notes — the report's own method note, caveats, definitions status, provenance. */
export function PrintNotes({ type, data, header }: { type: ReportType; data: ReportResponse<ReportType>; header: ReportHeader }) {
  const s = safeSummarise(type, data);
  const isLine = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
  // D6 (1 Oct 2026): the report's own notes — method, caveats, plausibility
  // window and every assumption awaiting IFL — composed once by the server
  // (header.reportNotes) so paper, CSV and XLSX agree. A server that predates
  // the field would leave the assumptions off the page, so any `pendingIfl`
  // line the notes do not already carry is added here, under its heading.
  // A note the page already prints elsewhere — in the executive summary or
  // beside the tables — is left out of this block: the CSV and the workbook
  // need it in their notes, the paper does not need it three times.
  const alreadyOnPage = new Set([...(s?.sentences ?? []), ...printedInBody(type, data)].map((t) => t.trim()).filter(Boolean));
  const headerNotes = (Array.isArray(header.reportNotes) ? header.reportNotes : []).filter(isLine).filter((n) => !alreadyOnPage.has(n.trim()));
  const pending = (() => {
    const p = (data?.report as { pendingIfl?: unknown } | null | undefined)?.pendingIfl;
    return Array.isArray(p) ? p.filter(isLine) : [];
  })();
  const pendingMissing = pending
    .filter((line) => !headerNotes.some((n) => n.includes(line)))
    .map((line) => `${W.iflReports.pendingHeading}: ${line}`);
  const items = [
    ...(s?.notes ?? []),
    ...headerNotes,
    ...pendingMissing,
    ...(s?.weightCaveat ? [W.printDoc.weightNote] : []),
    W.printDoc.clockNote,
    // ONE line about the approval status, in the reader's words. This block used to print `W.printDoc.approvalNote` ("Figures follow
    // KPI-DEFINITIONS.md, awaiting IFL's approval.") AND `W.reports.definitionsNote` ("Figure definitions are awaiting IFL's
    // approval."): the same status twice, the first citing a file name of the repository that nobody reading a printed report can open.
    W.reports.definitionsNote,
    ...(header.shiftNote ? [header.shiftNote] : []),
    W.printDoc.sourceNote,
    // Task B (28 Sep 2026): the same widened trigger as PrintHead.tsx —
    // spanning batches OR the source itself being the simulator, since a
    // simulator-only period excludes nothing and never sets spansGenerations.
    ...((header.spansGenerations || header.simulatorSource) && header.generationLine
      ? [header.generationLine]
      : header.spansGenerations
      ? [W.printDoc.generationNote(header.sourceGeneration ?? 'unknown', `${fmtInt(header.otherGenerationExcluded?.count ?? 0)} readings${header.otherGenerationExcluded?.percent != null ? ` (${header.otherGenerationExcluded.percent}%)` : ''}`)]
      : []),
  ];
  return (
    <section className="print-only pd-notes">
      <h2 className="pd-h">{W.printDoc.footnotes}</h2>
      <ol className="pd-footnotes">
        {[...new Set(items)].map((t) => <li key={t}>{t}</li>)}
      </ol>
      <p className="pd-conf">{W.printDoc.confidential}</p>
    </section>
  );
}
