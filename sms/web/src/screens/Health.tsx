/**
 * Health — is this SYSTEM healthy (as distinct from the line), for every
 * signed-in account. Roadmap Phase 11 item 2 (14 Sep 2026).
 *
 * Why a screen and not a Setup section: Setup is admin-only, IFL's accounts
 * are created at manager, and the strip's data-age sentence linked to Setup
 * — so for the people who will actually use the product the sentence was a
 * dead end and the sync's state was invisible. The strip now links here.
 *
 * Four blocks, one fact each, in the order an operator asks: the plant link
 * (the same SyncHealthBlock Setup shows — one component, so the two cannot
 * disagree), the database against SQL Server Express's 10 GB cap, the
 * service's version and uptime, and the age of the newest backup file.
 * Every threshold on this page is the developer's default and the copy says
 * so where IFL's answer would change it (words.ts `health`).
 */
import { usePolling } from '../lib/live';
import { W } from '../lib/words';
import { Block, Failed, SkelLines } from '../ui/bits';
import { fmtAppInstant, fmtSpan } from '../lib/fmt';
import { getHealth } from '../api';
import { SyncHealthBlock } from './health/SyncHealthBlock';

export function HealthScreen({ isAdmin }: { isAdmin: boolean }) {
  const h = usePolling(() => getHealth(), 30_000, 'health');
  const r = h.data ?? null;

  return (
    <>
      <div className="page">
        <p className="q">{W.health.question}</p>
        <h1 className="wide">{W.health.title}</h1>
        {r && (
          <p className={r.status === 'ok' ? '' : 'acc'} style={{ fontSize: 'var(--fs-qual)', marginTop: 8 }}>
            {W.health.status[r.status]}
          </p>
        )}
      </div>

      <SyncHealthBlock first isAdmin={isAdmin} />

      <Block label={W.health.database}>
        {h.error && !r ? (
          <Failed error={h.error} onRetry={h.refresh} />
        ) : !r ? (
          <SkelLines n={2} short />
        ) : (
          <>
            <p>
              {r.database.ok ? W.health.dbLatency(r.database.latencyMs ?? 0) : W.health.status.down}
            </p>
            <p style={{ marginTop: 8 }}>
              {r.database.sizeMb == null || r.database.pctOfCap == null
                ? W.health.dbSizeUnknown
                : W.health.dbSize(r.database.sizeMb.toFixed(0), r.database.pctOfCap.toFixed(1), Math.round(r.database.capMb / 1024))}
            </p>
            {r.database.pctOfCap != null && r.database.pctOfCap >= 80 && (
              <p className="acc" style={{ marginTop: 8, maxWidth: '70ch' }}>{W.health.dbNearCap}</p>
            )}
            {r.degradedReason && (
              <p className="acc sm" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{W.health.degradedBecause(r.degradedReason)}</p>
            )}
          </>
        )}
      </Block>

      <Block label={W.health.service}>
        {!r ? (
          <SkelLines n={2} short />
        ) : (
          <>
            <p>
              {W.health.version(r.service.version)} · {W.health.upSince(fmtSpan(r.service.uptimeSeconds))}
              {' · '}
              <span className="mut">since {fmtAppInstant(r.service.startedAtUtc)}</span>
            </p>
            <p className="mut sm" style={{ marginTop: 6 }}>{W.health.restarted}</p>
          </>
        )}
      </Block>

      <Block label={W.health.backup}>
        {!r ? (
          <SkelLines n={2} short />
        ) : r.backup == null ? (
          <p className="mut">{W.health.backupNone}</p>
        ) : (
          <>
            <p className={r.backup.warning ? 'acc' : ''}>
              {r.backup.newestFile && r.backup.newestAtUtc
                ? W.health.backupLast(fmtSpan(Math.round((r.backup.ageDays ?? 0) * 86_400)), r.backup.newestFile)
                : W.health.backupNone}
            </p>
            {r.backup.warning && <p className="acc sm" style={{ marginTop: 6, maxWidth: '70ch' }}>{W.health.backupWarn}</p>}
            <p className="mut sm" style={{ marginTop: 6 }}>{W.health.backupDir(r.backup.dir)}</p>
          </>
        )}
      </Block>
    </>
  );
}
