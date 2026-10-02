/**
 * "Assumed until IFL confirms" — the one place a report says, plainly, which
 * of its own choices still wait for IFL (CLAUDE.md rule 17: never guess past
 * an IFL dependency; use a labelled default and print it).
 *
 * Every one of IFL's eight reports carries `pendingIfl: string[]`. This
 * renders it under the shared heading, and renders NOTHING when the list is
 * empty or missing — a report that assumes nothing must not print an empty
 * heading, and a payload that omits the field (an older server, a fuzzed
 * test) must not take the screen down.
 *
 * Screen only (`no-print`): on paper the same lines reach the reader as
 * numbered closing notes (PrintDoc.tsx's PrintNotes reads the header's
 * `reportNotes`, which the server builds FROM `pendingIfl`, and falls back
 * to the report's own list when a server predates that field), so a printed
 * report never states an assumption twice.
 */
import { W } from '../../lib/words';
import { Block } from '../../ui/bits';

export function PendingIfl({ lines }: { lines: readonly string[] | null | undefined }) {
  const items = [...new Set((lines ?? []).filter((l) => typeof l === 'string' && l.trim() !== ''))];
  if (items.length === 0) return null;
  return (
    <div className="no-print" data-testid="pending-ifl">
      <Block label={W.iflReports.pendingHeading}>
        <ul className="mut sm" style={{ margin: 0, paddingLeft: 18 }}>
          {items.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </Block>
    </div>
  );
}
