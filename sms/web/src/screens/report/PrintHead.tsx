/**
 * The print header — roadmap Phase 8 (15 Sep 2026).
 *
 * Hidden on screen (`.print-head` is `display: none` until `@media print`),
 * and the first thing on the printed page: which line, which report, which
 * period, generated when on the PLANT's clock, by whom, from which SMS
 * version, and that the definitions await IFL's approval. A printed page
 * without these is an undated, unattributed sheet of numbers — which is
 * what the Readings screen's Print button used to produce (gap analysis §10).
 *
 * The header comes from the server (`/api/reports/<type>` carries it, and
 * `/api/reports/header` gives it on its own for the register), so the JSON
 * the screen renders, the CSV's trailing rows and this block all say the
 * same thing. Nothing here is computed from the browser's clock.
 */
import { usePolling } from '../../lib/live';
import { W } from '../../lib/words';
import { getReportHeader, type ReportHeader } from '../../api';

/** "15 Sep 2026, 14:03" on the plant's clock (rendered in UTC, like every reading time). */
export function fmtPlantInstant(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** One line of attribution, the same words on the page, the verdict mark and the print header. */
export function generatedLine(h: ReportHeader): string {
  return `${W.reports.generated} ${fmtPlantInstant(h.generatedAtPlantUtc)} ${W.reports.generatedBy} ${h.generatedBy} · ${W.reports.version} ${h.smsVersion}`;
}

export function PrintHead({ header, title }: { header: ReportHeader | null; title?: string }) {
  if (!header) return null;
  const filters = Object.entries(header.filters)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(' · ');
  return (
    <div className="print-head">
      <b>
        {header.lineName} · {title ?? header.title} · {header.period.from}
        {header.period.to !== header.period.from ? ` to ${header.period.to}` : ''}
        {filters ? ` · ${filters}` : ''}
      </b>
      <div>{generatedLine(header)}</div>
      <div className="mut sm">{W.reports.definitionsNote}</div>
    </div>
  );
}

/**
 * The same block for a screen that has no report response of its own — the
 * register's Print button. Fetches the header for the period, re-fetched
 * every five minutes so a page left open still prints a current stamp.
 */
export function RegisterPrintHead({ from, to, at, title }: { from: string; to: string; at: string | null; title: string }) {
  const h = usePolling(() => getReportHeader({ from, to, at }), 5 * 60_000, `print-head:${from}:${to}:${at ?? ''}`);
  return <PrintHead header={h.data?.header ?? null} title={title} />;
}
