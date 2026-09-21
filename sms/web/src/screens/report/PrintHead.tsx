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
import { useLive, usePolling } from '../../lib/live';
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
 *
 * Unlike Report.tsx (whose Print button is `disabled={!data}`, so a missing
 * header simply cannot be printed), Readings' Print button carries no such
 * gate — that gap is Readings.tsx's alone to close, and this phase does not
 * touch it (a `disabled` change is a behaviour change). So when the header
 * poll fails, this block cannot just vanish the way `PrintHead(null)` does:
 * the reader can still print, and a page that leaves the building with no
 * statement of where it came from is the defect this exists to close.
 *
 * The degraded block states what it still knows without the server — the
 * line (from the already-live `useLive()` context, the same source
 * Report.tsx's Verdict mark uses), and the title/period the CALLER already
 * holds as props (Readings.tsx composes both from state it already has, no
 * server round trip needed) — and NAMES the three facts it cannot state:
 * when it was generated, by whom, and from which SMS version. It never
 * falls back to the browser's clock for the "generated" instant: the plant
 * clock and the viewer's clock are five hours apart (TWO CLOCKS,
 * `api/src/services/plantClock.ts`), and a wrong instant printed as fact is
 * worse than an admitted gap.
 */
export function RegisterPrintHead({ from, to, at, title }: { from: string; to: string; at: string | null; title: string }) {
  const h = usePolling(() => getReportHeader({ from, to, at }), 5 * 60_000, `print-head:${from}:${to}:${at ?? ''}`);
  const { line } = useLive();
  if (h.data?.header) return <PrintHead header={h.data.header} title={title} />;
  if (h.error) {
    return (
      <div className="print-head">
        <b>
          {line?.lineName ? `${line.lineName} · ` : ''}
          {title}
          {' · '}
          {from}
          {to !== from ? ` to ${to}` : ''}
        </b>
        <div className="mut sm">{W.reports.generatedUnavailable}</div>
        <div className="mut sm">{W.reports.printedSelectionNote}</div>
      </div>
    );
  }
  return null;
}
