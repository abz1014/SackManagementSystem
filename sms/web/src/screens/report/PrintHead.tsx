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

/** "5 September 2026" or "5 – 7 September 2026" style period for the cover band. */
function periodText(from: string, to: string): string {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  return from === to ? f(from) : `${f(from)} to ${f(to)}`;
}

/**
 * The branded cover band (25 Sep 2026 report-document pass): company and
 * system, the report's title, and a labelled grid of line / period /
 * filters, then the one attribution line every printed page carries. The
 * "generated" instant is the PLANT clock (TWO CLOCKS) and is labelled so.
 */
export function PrintHead({ header, title }: { header: ReportHeader | null; title?: string }) {
  if (!header) return null;
  const filters = Object.entries(header.filters)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(' · ');
  return (
    <div className="print-head">
      <div className="ph-brand">
        <span className="ph-co">{W.printDoc.company}</span>
        <span className="ph-sys">{W.printDoc.system}</span>
        <span className="ph-tag">{W.printDoc.internal}</span>
      </div>
      <div className="ph-title">{title ?? header.title}</div>
      <dl className="ph-meta">
        <div><dt>{W.printDoc.line}</dt><dd>{header.lineName}</dd></div>
        <div><dt>{W.printDoc.period}</dt><dd>{periodText(header.period.from, header.period.to)}</dd></div>
        {filters && <div><dt>{W.printDoc.filters}</dt><dd>{filters}</dd></div>}
        <div><dt>{W.printDoc.generatedAt}</dt><dd>{fmtPlantInstant(header.generatedAtPlantUtc)}</dd></div>
        <div><dt>{W.printDoc.generatedBy}</dt><dd>{header.generatedBy}</dd></div>
        <div><dt>{W.printDoc.version}</dt><dd>{W.reports.version} {header.smsVersion}</dd></div>
      </dl>
      <div className="ph-foot">
        <span>{generatedLine(header)}</span>
        <span>{W.reports.definitionsNote}</span>
      </div>
      {/* Task B (28 Sep 2026): prints when the period spans batches OR the
          source itself is the simulator — a period entirely covered by the
          simulator excludes nothing (spansGenerations stays false), so
          spansGenerations alone used to leave a simulator-only page with no
          disclosure at all. */}
      {(header.spansGenerations || header.simulatorSource) && (
        <div className="ph-foot mut">
          {header.generationLine ?? `Data batch: ${header.sourceGeneration ?? 'unknown'}. Excluded from another batch: ` +
            `${header.otherGenerationExcluded?.count ?? 0} readings` +
            `${header.otherGenerationExcluded?.percent != null ? ` (${header.otherGenerationExcluded.percent}%)` : ''}.`}
        </div>
      )}
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
export function RegisterPrintHead({
  from,
  to,
  at,
  title,
  /** Task B (28 Sep 2026): the batch the on-screen register is reading —
   *  the printed header must name the SAME batch the screen shows, never a
   *  second, independently-resolved default. */
  batch,
}: {
  from: string;
  to: string;
  at: string | null;
  title: string;
  batch?: string;
}) {
  const h = usePolling(
    () => getReportHeader({ from, to, at, batch }),
    5 * 60_000,
    `print-head:${from}:${to}:${at ?? ''}:${batch ?? 'auto'}`,
  );
  const { line } = useLive();
  if (h.data?.header) return <PrintHead header={h.data.header} title={title} />;
  if (h.error) {
    return (
      <div className="print-head">
        <div className="ph-brand">
          <span className="ph-co">{W.printDoc.company}</span>
          <span className="ph-sys">{W.printDoc.system}</span>
          <span className="ph-tag">{W.printDoc.internal}</span>
        </div>
        <b className="ph-title">
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
