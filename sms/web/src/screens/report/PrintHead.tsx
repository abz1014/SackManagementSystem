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

/**
 * The batch/simulator disclosure sentence — same rule as the print header's
 * own `(header.spansGenerations || header.simulatorSource)` gate (Task B, 28
 * Sep 2026): fires when the period spans two IFL batches OR the source itself
 * is the simulator, never for a single real batch. Shared so the on-screen
 * line (`GenerationDisclosure` below, re-audit fix, 29 Sep 2026) and the
 * printed one (`PrintHead`) always say the identical sentence.
 */
export function generationDisclosureText(h: ReportHeader): string | null {
  if (!h.spansGenerations && !h.simulatorSource) return null;
  return (
    h.generationLine ??
    `Data batch: ${h.sourceGeneration ?? 'unknown'}. Excluded from another batch: ` +
      `${h.otherGenerationExcluded?.count ?? 0} readings` +
      `${h.otherGenerationExcluded?.percent != null ? ` (${h.otherGenerationExcluded.percent}%)` : ''}.`
  );
}

/**
 * Re-audit fix (29 Sep 2026): the batch/simulator disclosure used to exist
 * ONLY inside `.print-head`, which is `display: none` on screen (app.css) —
 * so a report spanning two IFL batches, or built entirely from the plant
 * simulator, stated that fact nowhere a reader would ever see it before
 * printing. This renders the same sentence `generationDisclosureText`
 * produces, once, near the report headline. `no-print` keeps it from
 * doubling up with `PrintHead`'s own copy on the printed page.
 */
export function GenerationDisclosure({ header }: { header: ReportHeader | null }) {
  if (!header) return null;
  const text = generationDisclosureText(header);
  if (!text) return null;
  return <p className="mut sm no-print" style={{ marginTop: 4 }}>{text}</p>;
}

/** "2026-09-15" to "15-09-2026" — IFL house style, DD-MM-YYYY everywhere in reports. */
export function fmtDmy(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

/** "15-09-2026 14:03" on the plant's clock. */
export function fmtPlantDmyTime(iso: string): string {
  const t = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}-${p(t.getUTCMonth() + 1)}-${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

function periodText(from: string, to: string): string {
  return from === to ? fmtDmy(from) : `${fmtDmy(from)} to ${fmtDmy(to)}`;
}

/**
 * The masthead's Period row: the calendar days, and — when the report was asked for a shift-bounded range — the shifts in plain words after
 * them, "02-09-2026 to 03-09-2026 (2 Sep morning shift – 3 Sep night shift)". The body of such a report (and its PDF, CSV and workbook) is
 * built from the shift-bounded figures, so a masthead naming only whole days would state a wider period than the page holds. The server's
 * `periodLabel` is the plain `from to to` when there is no shift range (header.ts), which prints nothing extra; the same rule as csv.ts's
 * `periodText`, which the CSV's period row and the workbook's banner use.
 */
export function mastheadPeriod(h: Pick<ReportHeader, 'period' | 'periodLabel'>): string {
  const plain = periodText(h.period.from, h.period.to);
  const label = h.periodLabel?.trim();
  return label && label !== `${h.period.from} to ${h.period.to}` ? `${plain} (${label})` : plain;
}

/**
 * The place line under the company name: plant, unit and line as the report
 * header carries them (sms.plant / sms.unit / sms.line, read by the server's
 * buildHeader), never a name typed into this file. A hard-coded "Textile
 * Plant 4" used to be printed above reports of TP1 Line 3 / Unit 2 (D-48).
 * A part that another part already contains ("TP1" inside "TP1 · Line 3 ·
 * Unit 2", which is how the line's display name is stored) is dropped so
 * nothing prints twice; a header with none of the three yields "".
 */
export function mastheadPlace(h: Pick<ReportHeader, 'plantName' | 'unitName' | 'lineName'> | null | undefined): string {
  const parts = [h?.plantName, h?.unitName, h?.lineName]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p !== '');
  const has = (outer: string, inner: string) => outer.toLowerCase().includes(inner.toLowerCase());
  return parts
    .filter((p, i) => !parts.some((q, j) => j !== i && has(q, p) && (q.length > p.length || (q.length === p.length && j < i))))
    .join(' · ');
}

/** Logo + centred company line + place + underlined title: the IFL house-style masthead. */
function Masthead({ title, place }: { title: string; place?: string }) {
  return (
    <div className="ph-mast">
      <img className="ph-logo" src="/ifl-logo.jpg" alt={W.printDoc.logoAlt} />
      <div className="ph-center">
        <div className="ph-company">{W.printDoc.company}</div>
        {place ? <div className="ph-place" style={{ fontSize: '10pt', color: '#333', marginTop: 2 }}>{place}</div> : null}
        {title && <div className="ph-title">{title}</div>}
      </div>
    </div>
  );
}

/**
 * IFL house-style header (30 Sep 2026): logo top-left, centred company line,
 * underlined title, and a right-aligned compact metadata grid. Every
 * disclosure sentence (definitions, shift, batch/simulator) now lives in the
 * numbered footnote block at the END of the document (PrintDoc.tsx's
 * PrintNotes) — `inlineNotes` keeps them here only for the register, which
 * has no closing block. "Generated" is the PLANT clock (TWO CLOCKS).
 */
export function PrintHead({ header, title, inlineNotes = false }: { header: ReportHeader | null; title?: string; inlineNotes?: boolean }) {
  if (!header) return null;
  const other = Object.entries(header.filters)
    .filter(([k, v]) => v != null && k !== 'shift')
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(' · ');
  const shift = header.filters.shift ? (W.printDoc.shiftHours[header.filters.shift] ?? header.filters.shift) : null;
  return (
    <div className="print-head">
      <Masthead title={title ?? header.title} place={mastheadPlace(header)} />
      <dl className="ph-meta">
        <div><dt>{W.printDoc.line}</dt><dd>{header.lineName}</dd></div>
        <div><dt>{W.printDoc.period}</dt><dd>{mastheadPeriod(header)}</dd></div>
        {shift && <div><dt>{W.printDoc.shift}</dt><dd>{shift}</dd></div>}
        {other && <div><dt>{W.printDoc.filters}</dt><dd>{other}</dd></div>}
        <div><dt>{W.printDoc.generatedBy}</dt><dd>{header.generatedBy}</dd></div>
        <div><dt>{W.printDoc.generatedAt}</dt><dd>{fmtPlantDmyTime(header.generatedAtPlantUtc)}</dd></div>
      </dl>
      <div className="ph-foot">
        <span>{generatedLine(header)}</span>
        {inlineNotes && <span>{W.reports.definitionsNote}</span>}
      </div>
      {inlineNotes && header.shiftNote && <div className="ph-foot mut">{header.shiftNote}</div>}
      {inlineNotes && generationDisclosureText(header) && (
        <div className="ph-foot mut">{generationDisclosureText(header)}</div>
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
  if (h.data?.header) return <PrintHead header={h.data.header} title={title} inlineNotes />;
  if (h.error) {
    return (
      <div className="print-head">
        <Masthead title="" />
        <b className="ph-degraded">
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
