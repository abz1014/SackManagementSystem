/**
 * Three standing facts the app-owned sidecar database already held and no
 * screen had ever read back (UX Phase 7 Brief 2 built `/api/system-history`;
 * Brief 3 wires it to a screen for the first time — see
 * web/src/api.callers.test.ts's ALLOW_LIST, whose `getSystemHistory` entry
 * this closes).
 *
 *  - Source generations (`sms.source_epoch`) — every physical generation of
 *    every source table this system has ever read from, open AND closed.
 *    /api/operations' own `schema` block only ever shows the open one per
 *    table (right for "is the worker enforcing a fingerprint right now",
 *    wrong for "what has this system ever held") — this is the first place
 *    July's 142,511 cones and September's 132,552, under different
 *    generations, are both visible on one screen.
 *  - Rebuilds (`sms.rebuild_audit`) — every canonical re-derivation this
 *    system has run over already-synced rows, never a re-fetch from IFL.
 *  - The last `sms verify` run (`sms.verify_run`) — a MANUAL, point-in-time
 *    reconciliation against IFL's own source, never folded into /api/health's
 *    status roll-up and never allowed to read as a live or continuous check
 *    (CLAUDE.md: "a run against DATA_TP1U2_SEP07 must never be readable as a
 *    run against the plant" — W.health.lastVerify.isManual is the sentence
 *    that keeps that true).
 */
import { usePolling } from '../../lib/live';
import { W } from '../../lib/words';
import { Block, Details, Failed, SkelLines } from '../../ui/bits';
import { fmtAppInstant, fmtSpan } from '../../lib/fmt';
import { getSystemHistory } from '../../api';

/** Seconds between an app-UTC instant and now, for "last run N ago". */
function secondsAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

export function SystemHistoryBlock() {
  const h = usePolling(() => getSystemHistory(), 5 * 60_000, 'system-history');
  const d = h.data?.data ?? null;

  const archivedNotes = (d?.generations ?? []).filter((g) => g.archivedBelowId != null);

  return (
    <Block label={W.health.epochRegister.title}>
      <p className="mut sm">{W.health.epochRegister.note}</p>

      {h.error && !d ? (
        <Failed error={h.error} onRetry={h.refresh} />
      ) : !d ? (
        <SkelLines n={3} short />
      ) : d.generations.length === 0 ? (
        <p className="mut" style={{ marginTop: 12 }}>{W.health.epochRegister.none}</p>
      ) : (
        <div className="tw" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>{W.health.epochRegister.colTable}</th>
                <th className="n">{W.health.epochRegister.colOrdinal}</th>
                <th>{W.health.epochRegister.colProvenance}</th>
                <th>{W.health.epochRegister.colFirstSeen}</th>
                <th>{W.health.epochRegister.colLastSeen}</th>
                <th>{W.health.epochRegister.colStatus}</th>
                <th>{W.health.epochRegister.colBy}</th>
              </tr>
            </thead>
            <tbody>
              {d.generations.map((g) => (
                <tr key={g.epochId}>
                  <td>{g.sourceTable}</td>
                  <td className="n">{g.generationOrdinal}</td>
                  <td>{g.provenance}</td>
                  <td>{fmtAppInstant(g.firstSeenUtc)}</td>
                  <td>{g.lastSeenUtc == null ? '—' : fmtAppInstant(g.lastSeenUtc)}</td>
                  <td className={g.closedUtc == null ? '' : 'mut'}>
                    {g.closedUtc == null ? W.health.epochRegister.open : W.health.epochRegister.closed(fmtAppInstant(g.closedUtc))}
                  </td>
                  <td>{W.health.epochRegister.registeredBy(g.registeredBy, fmtAppInstant(g.firstSeenUtc))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The archived floor: the oldest day this system still holds a local
          copy of, for a generation whose earlier rows are no longer local
          (IFL keeps about a month of its own copy — CLAUDE.md). Printed once
          per generation that has one, not folded into the table above so it
          reads as the caveat it is rather than another column. */}
      {archivedNotes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {archivedNotes.map((g) => (
            <p key={g.epochId} className="mut sm">
              {g.sourceTable}: {W.health.epochRegister.archivedFloor(g.archivedObservedUtc == null ? '—' : fmtAppInstant(g.archivedObservedUtc))}
            </p>
          ))}
        </div>
      )}

      <Details summary={W.health.rebuildAudit.title}>
        <p className="mut sm">{W.health.rebuildAudit.note}</p>
        {h.error && !d ? (
          <Failed error={h.error} onRetry={h.refresh} />
        ) : !d ? (
          <SkelLines n={2} short />
        ) : d.rebuilds.length === 0 ? (
          <p className="mut" style={{ marginTop: 12 }}>{W.health.rebuildAudit.none}</p>
        ) : (
          <div className="tw" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>{W.health.rebuildAudit.colWhen}</th>
                  <th>{W.health.rebuildAudit.colReason}</th>
                  <th>{W.health.rebuildAudit.colBy}</th>
                  <th className="n">{W.health.rebuildAudit.colRows}</th>
                </tr>
              </thead>
              <tbody>
                {d.rebuilds.map((rb) => (
                  <tr key={rb.rebuildId}>
                    <td>{fmtAppInstant(rb.startedAtUtc)}</td>
                    {/* sms.rebuild_audit carries no free-text reason column
                        (migration 010) — the closest honest substitute is
                        which table, under which transform-version change,
                        which is the actual cause of a rebuild
                        (a shift-rule correction or a re-attribution). */}
                    <td>
                      {rb.targetTable}, transform v{rb.fromTransformVersion} → v{rb.toTransformVersion}
                      {rb.outcome !== 'success' && (
                        <span className="acc sm" style={{ display: 'block' }}>
                          {rb.outcome}
                          {rb.errorMessage ? `: ${rb.errorMessage}` : ''}
                        </span>
                      )}
                    </td>
                    <td>{rb.initiatedBy == null ? W.health.noActor : `#${rb.initiatedBy}`}</td>
                    <td className="n">{rb.rowsRebuilt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Details>

      <Details summary={W.health.lastVerify.title}>
        {h.error && !d ? (
          <Failed error={h.error} onRetry={h.refresh} />
        ) : !d ? (
          <SkelLines n={2} short />
        ) : d.verifyRuns.length === 0 ? (
          <p className="mut">{W.health.lastVerify.none}</p>
        ) : (
          (() => {
            // sms.verify_run is written newest-first (verify_run_id DESC) —
            // the last thing a person ran, not the last thing the worker did.
            const v = d.verifyRuns[0]!;
            return (
              <>
                <p>
                  {W.health.lastVerify.ranAt(`${fmtAppInstant(v.startedAtUtc)} (${fmtSpan(secondsAgo(v.startedAtUtc))} ${W.ago})`)}{' '}
                  {W.health.lastVerify.against(v.sourceServer, v.sourceDb)}
                </p>
                <p className={v.verdict === 'clean' ? '' : 'acc'} style={{ marginTop: 6 }}>
                  {v.verdict === 'clean' ? W.health.lastVerify.verdict.ok : W.health.lastVerify.verdict.mismatch}
                  {v.verdict !== 'clean' && v.stops > 0 ? ` (${v.stops})` : ''}
                </p>
                {v.summary && <p className="mut sm" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{v.summary}</p>}
                {/* Load-bearing (CLAUDE.md): without this a green "matched"
                    could be mistaken for an ongoing guarantee rather than a
                    photograph of one command run once against a NAMED
                    database — never the plant unless sourceServer/sourceDb
                    above actually say so. */}
                <p className="mut sm" style={{ marginTop: 6 }}>{W.health.lastVerify.isManual}</p>
              </>
            );
          })()
        )}
      </Details>
    </Block>
  );
}
