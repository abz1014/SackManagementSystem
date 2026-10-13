/**
 * System > Diagnostics (task E12; board design/redesign-2026-10/mockups/Diagnostics.dc.html).
 *
 * Is SMS itself healthy: three lights (the data feed from IFL, the database, the backups), what each IFL feed has sent,
 * the data sources in plain sentences (pipeline names only inside "Technical detail"), the data checks with acknowledge,
 * the manual comparison against IFL, the service, and the records SMS holds. The verdicts are the server's: the live
 * health kind, database.ok, backup.warning. Each part fetches on its own and a failure names that part, so one failed
 * request never reads as "nothing wrong" (CLAUDE.md, UX Phase 7).
 */
import type { ReactNode } from 'react';
import {
  getHealth, getOperations, getReconciliation, getSystemHistory, type ConeState, type WeightAggregate,
} from '../../../bridge/api';
import { fmt, healthWords, live, period as P } from '../../../bridge/lib';
import { W } from '../../../bridge/words';
import { C, formatClock, formatDate } from '../../../copy';
import { useData, usePeriod, type DataState } from '../../../data';
import { Disclosure } from '../../../ui/Disclosure';
import { ErrorState } from '../../../ui/ErrorState';
import { Skeleton } from '../../../ui/Skeleton';
import { StatusPill } from '../../../ui/StatusPill';
import type { ScreenProps } from '../../registry';
import { SystemTabs } from '../SystemTabs';
import { SY, TECH } from '../systemCopy';
import { DqFindings } from './DqFindings';
import { backupState, dbState, feedKind, feedName, feedRowState, feedState, feedVerdict, groupSources, headline } from './model';
import '../system.css';

const D = SY.diag;
const STATES: ConeState[] = ['within', 'low', 'high', 'rejected', 'unknown'];

const gb = (mb: number) => `${(mb / 1024).toFixed(0)} GB`;
const plain = (iso: string) => `${formatDate(iso)} ${formatClock(iso)}`;

export function DiagnosticsScreen(props: ScreenProps) {
  const { route, rank, go } = props;
  const { line } = live.useLive();
  const health = useData('system status', () => getHealth(), 'system-health', { intervalMs: 30_000 });
  const ops = useData('data checks', () => getOperations(), 'system-operations', { intervalMs: 60_000 });
  const history = useData('data sources', () => getSystemHistory(), 'system-history', { intervalMs: 5 * 60_000 });

  const report = health.data;
  const kind = feedKind(line);
  const feedAge = line?.health?.ageSeconds ?? null;
  const sentence = report || health.status === 'error' ? headline(report, kind, feedAge == null ? null : fmt.fmtSpan(feedAge)) : null;

  return (
    <div className="sy-page">
      <SystemTabs route={route} rank={rank} go={go} />
      <header className="sy-head">
        <h1 className="sy-title">{SY.title}</h1>
        {sentence && <p className="sy-sentence">{sentence}</p>}
      </header>

      <div className="sy-lights">
        <FeedLight kind={kind} line={line} />
        <DatabaseLight state={health} />
        <BackupLight state={health} />
      </div>

      <section className="card sy-card" aria-labelledby="sy-feeds">
        <div className="sy-card__head">
          <h2 id="sy-feeds" className="sy-card__title">{D.feeds.title}</h2>
          <span className="caption">{D.feeds.caption}</span>
        </div>
        <FeedsTable state={ops} />
      </section>

      <div className="sy-two">
        <section className="card sy-card" aria-labelledby="sy-src">
          <div className="sy-card__head"><h2 id="sy-src" className="sy-card__title">{D.sources.title}</h2></div>
          <SourcesList state={history} />
        </section>
        <section className="card sy-card" aria-labelledby="sy-dq">
          <div className="sy-card__head">
            <h2 id="sy-dq" className="sy-card__title">{D.checks.title}</h2>
            <span className="caption">{D.checks.caption}</span>
          </div>
          {ops.status === 'loading' ? (
            <Skeleton part={D.parts.checks} height={160} onRetry={ops.refresh} />
          ) : ops.data == null ? (
            <ErrorState part={D.parts.checks} cause={ops.error ?? undefined} onRetry={ops.refresh} />
          ) : (
            <DqFindings
              findings={ops.data.data.dq.findings}
              rank={rank}
              onChanged={ops.refresh}
              onOpenReading={(type, id) => go({ ...route, sheet: { kind: type, id: String(id) } })}
            />
          )}
        </section>
      </div>

      <div className="sy-two">
        <VerifyCard history={history} health={health} readingIso={line?.dataAsOfUtc ?? null} />
        <ServiceCard state={health} />
      </div>

      <Counts />

      <p className="sy-note sy-pdas">
        {D.pdas.text} <a className="ui-link" href="?s=products&t=board">{D.pdas.link}</a>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- lights */

type Health = DataState<Awaited<ReturnType<typeof getHealth>>>;
type Ops = DataState<Awaited<ReturnType<typeof getOperations>>>;
type History = DataState<Awaited<ReturnType<typeof getSystemHistory>>>;

function LightShell({ id, name, state, children }: { id: string; name: string; state: Parameters<typeof StatusPill>[0]['state']; children: ReactNode }) {
  return (
    <section className="card sy-light" aria-labelledby={id}>
      <div className="sy-light__head">
        <span className="sy-light__name" id={id}>{name}</span>
        <StatusPill state={state} />
      </div>
      {children}
    </section>
  );
}

function LightPending({ id, name, state }: { id: string; name: string; state: Health }) {
  return (
    <section className="card sy-light" aria-labelledby={id}>
      <div className="sy-light__head"><span className="sy-light__name" id={id}>{name}</span></div>
      {state.status === 'loading' ? (
        <Skeleton part={D.parts.health} height={96} onRetry={state.refresh} />
      ) : (
        <ErrorState part={D.parts.health} cause={state.error ?? undefined} onRetry={state.refresh} />
      )}
    </section>
  );
}

function FeedLight({ kind, line }: { kind: ReturnType<typeof feedKind>; line: ReturnType<typeof live.useLive>['line'] }) {
  const age = line?.health?.ageSeconds ?? null;
  const cadence = line?.health?.cadenceSeconds ?? null;
  return (
    <LightShell id="sy-l1" name={D.lights.feed} state={feedState(kind)}>
      <div className="sy-light__big">
        {age == null ? '—' : fmt.fmtSpan(age)}
        {age != null && <small>{D.feed.sinceCheck}</small>}
      </div>
      <p className="sy-light__d">{feedVerdict(kind)}</p>
      <p className="sy-light__d sy-light__d--m">
        {line?.dataAsOfUtc ? D.feed.lastReading(plain(line.dataAsOfUtc)) : D.feed.noReading}
        {cadence != null && ` ${D.feed.cadence(fmt.fmtSpan(cadence))}`}
      </p>
    </LightShell>
  );
}

function DatabaseLight({ state }: { state: Health }) {
  const r = state.data;
  if (!r) return <LightPending id="sy-l2" name={D.lights.database} state={state} />;
  const db = r.database;
  return (
    <LightShell id="sy-l2" name={D.lights.database} state={dbState(r)}>
      <div className="sy-light__big">
        {db.ok && db.latencyMs != null ? db.latencyMs : '—'}
        {db.ok && db.latencyMs != null && <small>{`ms ${D.db.answering}`}</small>}
      </div>
      <p className="sy-light__d">
        {!db.ok ? D.db.unreachable : db.sizeMb == null ? D.db.usedUnknown : D.db.used(db.sizeMb.toFixed(0), db.capMb.toFixed(0))}
      </p>
      {r.degradedReason && <p className="sy-light__d sy-light__d--m">{r.degradedReason}</p>}
      {db.pctOfCap != null && (
        <div className="sy-bar" role="img" aria-label={D.db.barLabel(db.pctOfCap.toFixed(0))}>
          <i style={{ width: `${Math.min(100, db.pctOfCap)}%` }} />
        </div>
      )}
    </LightShell>
  );
}

function BackupLight({ state }: { state: Health }) {
  const r = state.data;
  if (!r) return <LightPending id="sy-l3" name={D.lights.backups} state={state} />;
  const b = r.backup;
  const free = r.disk?.backupFreeMb ?? null;
  return (
    <LightShell id="sy-l3" name={D.lights.backups} state={backupState(r)}>
      {b == null || b.newestFile == null ? (
        <>
          <div className="sy-light__big">{'—'}</div>
          <p className="sy-light__d">{D.backups.none}</p>
        </>
      ) : (
        <>
          <div className="sy-light__big">
            {b.ageDays == null ? '—' : b.ageDays.toFixed(1)}
            <small>{D.backups.daysSince}</small>
          </div>
          <p className="sy-light__d">
            {b.newestAtUtc ? (b.verified ? D.backups.verified(fmt.fmtAppInstant(b.newestAtUtc)) : D.backups.unverified(fmt.fmtAppInstant(b.newestAtUtc))) : D.backups.none}
          </p>
        </>
      )}
      {b?.newestUnverified && <p className="sy-light__d sy-light__d--m">{D.backups.newestUnverified}</p>}
      {b?.warning && <p className="sy-light__d sy-light__d--m">{D.backups.overdue}</p>}
      {free != null && <p className="sy-light__d sy-light__d--m">{D.backups.freeFor(gb(free))}</p>}
    </LightShell>
  );
}

/* ----------------------------------------------------------------- feeds */

function FeedsTable({ state }: { state: Ops }) {
  if (state.status === 'loading') return <Skeleton part={D.parts.checks} height={160} onRetry={state.refresh} />;
  if (!state.data) return <ErrorState part={D.parts.checks} cause={state.error ?? undefined} onRetry={state.refresh} />;
  const sync = state.data.data.sync;
  const halted = state.data.data.source?.halted ?? [];
  if (sync.length === 0) return <p className="sy-note">{D.feeds.none}</p>;
  return (
    <>
      <div className="sy-tw">
        <table className="sy-table">
          <thead>
            <tr>
              <th>{D.feeds.colFeed}</th>
              <th>{D.feeds.colChecked}</th>
              <th className="sy-num">{D.feeds.colAdded}</th>
              <th>{D.feeds.colState}</th>
            </tr>
          </thead>
          <tbody>
            {sync.map((s) => (
              <tr key={s.targetTable}>
                <td className="sy-strong">{feedName(s.targetTable)}</td>
                <td>{s.finishedAtUtc ? fmt.fmtAppInstant(s.finishedAtUtc) : D.feeds.neverChecked}</td>
                <td className="sy-num">{fmt.fmtInt(s.rowsWritten)}</td>
                <td><StatusPill state={feedRowState(s)} noun={feedRowState(s) === 'ok' ? D.feeds.stateOk : D.feeds.stateStopped} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {halted.length > 0 && <p className="sy-note">{D.feeds.halted(halted.map(feedName).join(', '))}</p>}
      <Disclosure id="system-feed-tables" label={D.sources.detail}>
        <div className="sy-tw">
          <table className="sy-table sy-table--small">
            <thead>
              <tr>
                <th>{TECH.colTable}</th><th>{TECH.colOutcome}</th><th>{TECH.colBatch}</th>
                <th className="sy-num">{TECH.colWritten}</th><th className="sy-num">{TECH.colAge}</th>
              </tr>
            </thead>
            <tbody>
              {sync.map((s) => (
                <tr key={s.targetTable}>
                  <td>{s.targetTable}</td>
                  <td>{s.outcome}</td>
                  <td>{s.epochLabel ?? '—'}</td>
                  <td className="sy-num">{s.rowsWritten}</td>
                  <td className="sy-num">{s.ageSeconds == null ? '—' : fmt.fmtSpan(s.ageSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </>
  );
}

/* --------------------------------------------------------------- sources */

function SourcesList({ state }: { state: History }) {
  if (state.status === 'loading') return <Skeleton part={D.parts.history} height={160} onRetry={state.refresh} />;
  if (!state.data) return <ErrorState part={D.parts.history} cause={state.error ?? undefined} onRetry={state.refresh} />;
  const d = state.data.data;
  const groups = groupSources(d.generations);
  if (groups.length === 0) return <p className="sy-note">{D.sources.none}</p>;
  const sentence = (g: (typeof groups)[number]): [string, string] => {
    const n = g.cones == null ? null : fmt.fmtInt(g.cones);
    if (g.kind === 'current') return [D.sources.current, n ? D.sources.currentLine(n) : D.sources.currentLineNoCount];
    if (g.kind === 'older') return [D.sources.older, n ? D.sources.olderLine(n) : D.sources.olderLineNoCount];
    return [D.sources.practice, D.sources.practiceLine];
  };
  return (
    <>
      <ul className="sy-src">
        {groups.map((g) => {
          const [name, line] = sentence(g);
          return (
            <li key={g.key}>
              <b>{name}</b>
              <span>{line}</span>
            </li>
          );
        })}
      </ul>
      <Disclosure id="system-sources" label={D.sources.detail}>
        <div className="sy-tw">
          <table className="sy-table sy-table--small">
            <thead>
              <tr>
                <th>{TECH.colGeneration}</th><th>{TECH.colDatabase}</th><th>{TECH.colTable}</th>
                <th>{TECH.colSource}</th><th>{TECH.colStatus}</th><th className="sy-num">{TECH.colRows}</th>
              </tr>
            </thead>
            <tbody>
              {d.generations.map((g) => (
                <tr key={g.epochId}>
                  <td className="sy-strong">{g.label}</td>
                  <td>{g.sourceDb}</td>
                  <td>{g.sourceTable}</td>
                  <td>{g.provenance}</td>
                  <td>{g.closedUtc == null ? TECH.open : TECH.closed(fmt.fmtAppInstant(g.closedUtc))}</td>
                  <td className="sy-num">{fmt.fmtInt(g.rawRowCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sy-note">{D.sources.detailNote}</p>
        <p className="sy-note sy-strong">{TECH.rebuildsTitle}</p>
        {d.rebuilds.length === 0 ? (
          <p className="sy-note">{TECH.rebuildsNone}</p>
        ) : (
          <ul className="sy-plain">
            {d.rebuilds.map((rb) => (
              <li key={rb.rebuildId}>
                {fmt.fmtAppInstant(rb.startedAtUtc)}: {TECH.rebuildRow(rb.targetTable, rb.fromTransformVersion, rb.toTransformVersion)}
                {rb.outcome !== 'success' && ` (${rb.outcome}${rb.errorMessage ? `: ${rb.errorMessage}` : ''})`}
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </>
  );
}

/* ---------------------------------------------------------------- verify */

function VerifyCard({
  history, health, readingIso,
}: {
  history: History;
  health: Health;
  readingIso: string | null;
}) {
  const v = history.data?.data.verifyRuns[0] ?? null;
  const r = health.data;
  const ago = (iso: string) => fmt.fmtSpan(Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)));
  return (
    <section className="card sy-card" aria-labelledby="sy-verify">
      <div className="sy-card__head"><h2 id="sy-verify" className="sy-card__title">{D.verify.title}</h2></div>
      {history.status === 'loading' ? (
        <Skeleton part={D.parts.history} height={96} onRetry={history.refresh} />
      ) : !history.data ? (
        <ErrorState part={D.parts.history} cause={history.error ?? undefined} onRetry={history.refresh} />
      ) : v == null ? (
        <p className="sy-note">{D.verify.none}</p>
      ) : (
        <>
          <p>{D.verify.ranAt(fmt.fmtAppInstant(v.startedAtUtc), ago(v.startedAtUtc))}</p>
          <p>{v.verdict === 'clean' ? D.verify.matched : D.verify.mismatch}</p>
          <p className="sy-note">{D.verify.manual}</p>
          <details className="sy-tech">
            <summary>{D.sources.detail}</summary>
            <p className="sy-note">{TECH.verifyAgainst(v.sourceServer, v.sourceDb)}</p>
            {v.summary && <p className="sy-note sy-pre">{v.summary}</p>}
          </details>
        </>
      )}
      {r && (
        <p className="sy-note">
          {r.workerLastPassUtc == null
            ? D.verify.recorderNever
            : readingIso
              ? D.verify.recorderBoth(healthWords.fmtAppClock(r.workerLastPassUtc), fmt.fmtClock(readingIso))
              : D.verify.recorder(healthWords.fmtAppClock(r.workerLastPassUtc))}
        </p>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- service */

function ServiceCard({ state }: { state: Health }) {
  const r = state.data;
  return (
    <section className="card sy-card" aria-labelledby="sy-service">
      <div className="sy-card__head"><h2 id="sy-service" className="sy-card__title">{D.service.title}</h2></div>
      {state.status === 'loading' ? (
        <Skeleton part={D.parts.health} height={96} onRetry={state.refresh} />
      ) : !r ? (
        <ErrorState part={D.parts.health} cause={state.error ?? undefined} onRetry={state.refresh} />
      ) : (
        <>
          <p>
            {D.service.version(r.service.version)}, {D.service.upFor(fmt.fmtSpan(r.service.uptimeSeconds))} (since {fmt.fmtAppInstant(r.service.startedAtUtc)})
          </p>
          <p className="sy-note">{D.service.restarted}</p>
          {r.disk && (
            <>
              <p>{r.disk.appDataFreeMb == null ? D.service.diskUnknown(D.service.appDrive) : D.service.disk(gb(r.disk.appDataFreeMb), D.service.appDrive)}</p>
              <p>{r.disk.backupFreeMb == null ? D.service.diskUnknown(D.service.backupDrive) : D.service.disk(gb(r.disk.backupFreeMb), D.service.backupDrive)}</p>
              {healthWords.anyDiskLow(r.disk) && <p className="sy-note">{D.service.diskLow}</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- counts */

function Counts() {
  const per = usePeriod();
  return (
    <section className="card sy-card" aria-labelledby="sy-counts">
      <div className="sy-card__head"><h2 id="sy-counts" className="sy-card__title">{D.counts.title}</h2></div>
      {per.period ? (
        <CountsBody period={per.period} />
      ) : per.status === 'error' ? (
        <ErrorState part={D.parts.period} cause={C.periodUi.clockUnread} />
      ) : (
        <Skeleton part={D.parts.period} height={120} />
      )}
    </section>
  );
}

function CountsBody({ period }: { period: P.Period }) {
  const state = useData(
    'record counts',
    () =>
      getReconciliation(
        period.from, period.to, period.shift ?? null,
        period.fromShift ? P.encodeShiftRef(period.fromShift) : undefined,
        period.toShift ? P.encodeShiftRef(period.toShift) : undefined,
      ),
    `system-counts:${period.key}:${period.from}:${period.to}:${period.shift ?? ''}`,
    { intervalMs: 5 * 60_000, live: period.live },
  );
  if (state.status === 'loading') return <Skeleton part={D.parts.counts} height={120} onRetry={state.refresh} />;
  if (!state.data) return <ErrorState part={D.parts.counts} cause={state.error ?? undefined} onRetry={state.refresh} />;
  const d = state.data.data;
  const span = d.from === d.to ? formatDate(d.from) : C.period(formatDate(d.from), formatDate(d.to));
  const row = (label: string, a: WeightAggregate) => (
    <tr key={label}>
      <td className="sy-strong">{label}</td>
      <td className="sy-num">{fmt.fmtInt(a.n)}</td>
      <td className="sy-num">{fmt.fmtG(a.avgG)}</td>
      <td className="sy-num">{fmt.fmtG(a.minG)}</td>
      <td className="sy-num">{fmt.fmtG(a.maxG)}</td>
    </tr>
  );
  return (
    <>
      <p className="caption">{D.counts.caption(span)}</p>
      <div className="sy-cnts">
        <div><div className="sy-cnts__v">{fmt.fmtInt(d.total.n)}</div><div className="caption">{D.counts.total}</div></div>
        <div><div className="sy-cnts__v">{fmt.fmtInt(d.plausible.n)}</div><div className="caption">{D.counts.plausible}</div></div>
      </div>
      <Disclosure id="system-counts" label={D.counts.detail}>
        <div className="sy-tw">
          <table className="sy-table">
            <thead>
              <tr>
                <th>{D.counts.colState}</th><th className="sy-num">{D.counts.colCones}</th>
                <th className="sy-num">{D.counts.colAvg}</th><th className="sy-num">{D.counts.colMin}</th><th className="sy-num">{D.counts.colMax}</th>
              </tr>
            </thead>
            <tbody>
              {row(D.counts.total, d.total)}
              {row(D.counts.plausible, d.plausible)}
              {row(D.counts.implausible, d.implausible)}
              <tr>
                <td className="sy-strong">{D.counts.noWeight}</td><td className="sy-num">{fmt.fmtInt(d.noWeight)}</td>
                <td className="sy-num">{'—'}</td><td className="sy-num">{'—'}</td><td className="sy-num">{'—'}</td>
              </tr>
              {STATES.map((s) => row(W.cone.state[s], d.byState[s]))}
            </tbody>
          </table>
        </div>
        {/* The server's own note, verbatim: it names the weight basis and the unconfirmed window. */}
        <p className="sy-note">{d.note}</p>
      </Disclosure>
      <p className="sy-note">{D.counts.note}</p>
    </>
  );
}
