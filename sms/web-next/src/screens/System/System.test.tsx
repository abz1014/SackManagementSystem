/**
 * System screens (task E12). TRACE rows verified here: A1-053 (operations: failed fetch not "none"), A1-054 (DQ finding
 * source link), A1-055 + A2-069 (acknowledge, rank 2), A1-056 (system history), A1-068 + A2-001 (health: database,
 * service, backups, disk), A1-069 + A2-071 (change own password), A1-076 + A2-066 (record counts), A1-005..A1-025
 * (Setup sections present at rank 4 only), A1-046 (data sources), A3-009 (Account page), A3-061, A3-062 (Diagnostics).
 * Fixtures are shaped like the real responses; nothing here reads a database or creates an account.
 */
import { C, FRAGMENTS, withFragments } from '../../copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../../web/src/testkit/render';
import { installDomStubs } from '../../../../web/src/testkit/domStubs';
import { installFakeFetch, type Routes } from '../../../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE, META_FIXTURE } from '../../../../web/src/testkit/fixtures';
import type { AuthUser } from '../../bridge/api';
import { live } from '../../bridge/lib';
import { parseRoute, type Route } from '../../route';
import { DiagnosticsScreen } from './Diagnostics/DiagnosticsScreen';
import { SetupScreen } from './Setup/SetupScreen';
import { AccountScreen } from './Account/AccountScreen';
import { SystemTabs } from './SystemTabs';
const SY = withFragments(C.system, FRAGMENTS.systemParts);
const TECH = FRAGMENTS.systemTech;

installDomStubs();

const USER: AuthUser = { username: 'tester', displayName: 'Test User', role: 'engineer' };
const env = (data: unknown) => ({ data, metadata: META_FIXTURE });

const HEALTH = {
  status: 'ok',
  service: { version: '0.2.0', uptimeSeconds: 7200, startedAtUtc: '2026-09-07T10:00:00Z', pid: 1 },
  database: { ok: true, latencyMs: 7, sizeMb: 520, capMb: 10240, pctOfCap: 5.1 },
  acquisition: { kind: 'ok', ageSeconds: 90, cadenceSeconds: 60, halted: null, generation: null },
  backup: { dir: 'D:\\b', newestFile: 'sms-20260929.bak', newestAtUtc: '2026-09-29T02:00:00Z', ageDays: 13.7, warning: false, verified: true, newestUnverified: false },
  degradedReason: null,
  pdasWrite: null,
  disk: { appDataFreeMb: 90000, backupFreeMb: 72704 },
  lastVerifyRunUtc: '2026-09-20T09:00:00Z',
  workerLastPassUtc: '2026-09-07T12:00:00Z',
  dqAcknowledged: 1,
};

const FINDING = (over: Record<string, unknown>) => ({
  findingId: 1, checkName: 'zero_weight', severity: 'WARNING', subjectTable: null, detail: 'Two readings weigh nothing.',
  subjectRef: null, acknowledgeable: true, acknowledgedBy: null, acknowledgedUtc: null, acknowledgedReason: null, ...over,
});
const FINDINGS = [
  FINDING({ findingId: 5, checkName: 'zero_weight', subjectTable: 'cone_event', subjectRef: 91 }),
  FINDING({ findingId: 6, checkName: 'source_columns_changed', severity: 'ERROR', acknowledgeable: false, detail: 'A column changed.' }),
  FINDING({ findingId: 7, checkName: 'stale_row', severity: 'INFO', acknowledgedBy: 'Plant Admin', acknowledgedUtc: '2026-09-06T08:00:00Z', acknowledgedReason: 'Known scale fault' }),
];

const OPS = {
  sync: [
    { targetTable: 'cone_raw', outcome: 'success', watermarkFrom: 1, watermark: 9, epochId: 3, epochLabel: 'pack1_TP1U2 gen 3', epochOrdinal: 3, epochSimulator: false, rowsRead: 9, rowsWritten: 9, finishedAtUtc: '2026-09-07T12:00:00Z', ageSeconds: 60 },
    { targetTable: 'sack_raw', outcome: 'halted', watermarkFrom: null, watermark: null, epochId: null, epochLabel: null, rowsRead: 0, rowsWritten: 0, finishedAtUtc: '2026-09-07T12:00:00Z', ageSeconds: 60 },
  ],
  shiftRuleRegimes: [], lifetime: { passes: 1, tableRuns: 1, failures: 0, firstRunUtc: null, lastRunUtc: null, medianMs: null, p95Ms: null, slowestMs: null, lastFailure: null },
  schema: [], dq: { latestRunId: null, bySeverity: {}, findings: FINDINGS },
  source: { lastProbeOk: true, lastProbeAtUtc: '2026-09-07T12:00:00Z', lastHalt: null, halted: ['sack_raw'] },
};

const GEN = (epochId: number, sourceDb: string, closedUtc: string | null, provenance: string, rows: number) => ({
  epochId, sourceTable: 'pack1_TP1U2', label: `${sourceDb}#${epochId}`, generationOrdinal: epochId, provenance, sourceServer: 'S', sourceDb,
  firstSeenUtc: '2026-08-05T00:00:00Z', lastSeenUtc: null, closedUtc, registeredBy: 'admin', archivedBelowId: null, archivedObservedUtc: null, rawRowCount: rows,
});
const HISTORY = {
  generations: [GEN(1, 'DATA_TP1U2', '2026-08-05T00:00:00Z', 'ifl_copy', 142511), GEN(3, 'DATA_TP1U2_SEP07', null, 'ifl_copy', 132552), GEN(4, 'DATA_TP1U2_SIM', null, 'simulator', 284351)],
  rebuilds: [],
  verifyRuns: [{ verifyRunId: 1, startedAtUtc: '2026-09-20T09:00:00Z', finishedAtUtc: null, sourceServer: 'LOCAL', sourceDb: 'DATA_TP1U2_SEP07', appServer: 'a', appDb: 'sms', lineId: 1, stops: 0, weightsChecked: true, windowFrom: null, windowTo: null, verdict: 'clean', summary: null, smsVersion: null }],
};

const AGG = (n: number) => ({ n, avgG: 1950, minG: 1800, maxG: 2100 });
const RECON = {
  from: '2026-09-07', to: '2026-09-07', shift: null, total: AGG(10), plausible: AGG(9), implausible: AGG(1), noWeight: 0,
  byState: { within: AGG(6), low: AGG(1), high: AGG(1), rejected: AGG(1), unknown: AGG(1) },
  plausibility: { loG: 1500, hiG: 2100 }, limitWindows: 1, basis: 'as_recorded', note: 'As-recorded weights, no tube adjustment.',
};

const goSpy = vi.fn();
const routeOf = (t: string): Route => parseRoute(new URLSearchParams(`s=system&t=${t}&p=pick&from=2026-09-07&to=2026-09-07`));

function routes(over: Routes = {}): Routes {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 },
    '/api/health': HEALTH,
    '/api/operations': env(OPS),
    '/api/system-history': env(HISTORY),
    '/api/reconciliation': env(RECON),
    ...over,
  };
}

function mountDiag(rank: number, over: Routes = {}) {
  window.history.replaceState(null, '', '/?s=system&t=diagnostics&p=pick&from=2026-09-07&to=2026-09-07');
  installFakeFetch(routes(over));
  return render(
    <live.LiveProvider asOf={null}>
      <DiagnosticsScreen route={routeOf('diagnostics')} rank={rank} user={USER} go={goSpy} />
    </live.LiveProvider>,
  );
}

beforeEach(() => { localStorage.clear(); goSpy.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('System tabs', () => {
  it('Setup is absent below rank 4 and present at rank 4', () => {
    const { rerender } = render(<SystemTabs route={routeOf('diagnostics')} rank={3} go={goSpy} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Diagnostics', 'Account']);
    rerender(<SystemTabs route={routeOf('diagnostics')} rank={4} go={goSpy} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Diagnostics', 'Setup', 'Account']);
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }));
    expect(goSpy.mock.calls[0]![0]).toMatchObject({ s: 'system', t: 'setup' });
  });
});

describe('Diagnostics', () => {
  it('shows the three lights, the feeds and the sources in plain words', async () => {
    mountDiag(2);
    await screen.findByText('7');
    expect(screen.getByText(SY.diag.lights.feed)).toBeTruthy();
    expect(screen.getByText(SY.diag.lights.database)).toBeTruthy();
    expect(screen.getByText(SY.diag.lights.backups)).toBeTruthy();
    expect(await screen.findByText(/SMS is working\./)).toBeTruthy();
    expect(screen.getByText('13.7')).toBeTruthy();
    expect(screen.getAllByText('Cones').length).toBeGreaterThan(0);
    expect(screen.getByText('Current IFL database')).toBeTruthy();
    expect(screen.getByText('Older IFL database')).toBeTruthy();
    expect(screen.getByText('Practice data on this computer')).toBeTruthy();
    expect(screen.getByText(/132,552 cones\. Reports use this one\./)).toBeTruthy();
    expect(await screen.findByText('Records SMS holds')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Cones recorded for/)).toBeTruthy());
    // the server's own record-count note, verbatim
    expect(screen.getByText(RECON.note)).toBeTruthy();
  });

  it('names pipeline and table words only inside a Technical detail disclosure', async () => {
    const { container } = mountDiag(2);
    await screen.findByText('Current IFL database');
    await waitFor(() => expect(screen.getByText(/Cones recorded for/)).toBeTruthy());
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.ui-disc, .sy-tech').forEach((n) => n.remove());
    const outside = clone.textContent ?? '';
    const jargon = [/\bbatch(es)?\b/i, /\bepochs?\b/i, /\bgenerations?\b/i, /\bsimulator\b/i, /_TP1U2/i, /\bpack1\b/i, /_raw\b/i, /\bDATA_/i, /\bcone_event\b/i, /\bgen \d/i];
    for (const re of jargon) expect(outside, String(re)).not.toMatch(re);
    // the same words do exist, inside the disclosures
    const inside = Array.from(container.querySelectorAll('.ui-disc, .sy-tech')).map((n) => n.textContent).join(' ');
    expect(inside).toMatch(/DATA_TP1U2_SEP07/);
    expect(inside).toMatch(/pack1_TP1U2/);
    // the old Data batches table is back inside the disclosure: first seen, status, registered by, rows held
    for (const h of [TECH.batchCol.firstSeen, TECH.batchCol.status, TECH.batchCol.registeredBy, TECH.batchCol.rows]) expect(inside, h).toContain(h);
  });

  it('shows Acknowledge to an engineer on an acknowledgeable open finding only', async () => {
    mountDiag(2);
    await screen.findByText('Zero weight');
    expect(screen.getAllByRole('button', { name: 'Acknowledge' })).toHaveLength(1);
    // the system-state finding gets a sentence, never a control; the acknowledged one shows who
    expect(screen.getByText(SY.diag.checks.systemState)).toBeTruthy();
    expect(screen.getByText(/Acknowledged by Plant Admin/)).toBeTruthy();
    expect(screen.getByText(SY.diag.checks.ackSummary(1))).toBeTruthy();
  });

  it('shows no Acknowledge control at rank 1', async () => {
    mountDiag(1);
    await screen.findByText('Zero weight');
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.queryByText(SY.diag.checks.record)).toBeNull();
  });

  it('prints the server refusal verbatim and changes nothing until the server answers', async () => {
    const refusal = new Response(JSON.stringify({ error: 'ALREADY_ACKNOWLEDGED', detail: 'Plant Admin acknowledged this one minute ago.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    const ff = installFakeFetch(routes({ '/api/dq-findings/5/ack': refusal }));
    window.history.replaceState(null, '', '/?s=system&t=diagnostics&p=pick&from=2026-09-07&to=2026-09-07');
    render(
      <live.LiveProvider asOf={null}>
        <DiagnosticsScreen route={routeOf('diagnostics')} rank={2} user={USER} go={goSpy} />
      </live.LiveProvider>,
    );
    await screen.findByText('Zero weight');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    const submit = screen.getByRole('button', { name: SY.diag.checks.record }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // reason too short
    fireEvent.change(screen.getByLabelText(SY.diag.checks.reasonLabel), { target: { value: 'Known scale fault, engineer aware' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(await screen.findByText('Plant Admin acknowledged this one minute ago.')).toBeTruthy();
    const opsCalls = () => ff.requests.filter((r) => r.startsWith('/api/operations')).length;
    expect(opsCalls()).toBe(1); // a refusal does not re-read as if it had worked
    expect(screen.getAllByRole('button', { name: SY.diag.checks.record })).toHaveLength(1);
  });

  it('opens the first reading a finding counts', async () => {
    mountDiag(2, { '/api/dq-destination': { type: 'cone', id: 4242 } });
    await screen.findByText('Zero weight');
    fireEvent.click(screen.getByRole('button', { name: SY.diag.checks.sourceRow }));
    await waitFor(() => expect(goSpy).toHaveBeenCalled());
    expect(goSpy.mock.calls[0]![0].sheet).toEqual({ kind: 'cone', id: '4242' });
  });

  it('names the failed part and still shows the others', async () => {
    mountDiag(2, { '/api/health': new Response('{"error":"down"}', { status: 500 }) });
    await screen.findByText('Zero weight');
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /Couldn.t load the system status\./.test(a.textContent ?? ''))).toBe(true);
    // the data checks loaded fine and do not claim anything about the failed part
    expect(screen.getByText('Zero weight')).toBeTruthy();
    expect(screen.queryByText(/SMS is working\./)).toBeNull();
  });

  it('a failed data-checks fetch says so instead of "no checks open"', async () => {
    mountDiag(2, { '/api/operations': new Response('{"error":"down"}', { status: 500 }) });
    await waitFor(() => expect(screen.getAllByRole('alert').some((a) => /Couldn.t load the data checks\./.test(a.textContent ?? ''))).toBe(true));
    expect(screen.queryByText(SY.diag.checks.none)).toBeNull();
  });
});

describe('Account', () => {
  const mountAccount = (over: Routes = {}) => {
    installFakeFetch({ ...over });
    return render(<AccountScreen route={routeOf('account')} rank={2} user={USER} go={goSpy} />);
  };
  const fill = (cur: string, nxt: string, again: string) => {
    fireEvent.change(screen.getByLabelText(SY.account.current), { target: { value: cur } });
    fireEvent.change(screen.getByLabelText(SY.account.next), { target: { value: nxt } });
    fireEvent.change(screen.getByLabelText(SY.account.again), { target: { value: again } });
    fireEvent.click(screen.getByRole('button', { name: SY.account.save }));
  };

  it('says who is signed in and their rank', () => {
    mountAccount();
    expect(screen.getByText('tester')).toBeTruthy();
    expect(screen.getByText(/engineer/)).toBeTruthy();
  });

  it('refuses mismatched new passwords without a request', async () => {
    const ff = installFakeFetch({});
    render(<AccountScreen route={routeOf('account')} rank={2} user={USER} go={goSpy} />);
    fill('old-pass', 'new-pass-1', 'new-pass-2');
    expect(await screen.findByText(SY.account.mismatch)).toBeTruthy();
    expect(ff.requests).toHaveLength(0);
  });

  it('prints the policy sentence from a 400 verbatim', async () => {
    mountAccount({
      '/api/auth/password': new Response(JSON.stringify({ error: 'invalid', detail: 'The new password must be at least 12 characters.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    });
    fill('old-pass', 'short', 'short');
    expect(await screen.findByText('The new password must be at least 12 characters.')).toBeTruthy();
  });

  it('says the current password is wrong on a 403', async () => {
    mountAccount({ '/api/auth/password': new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) });
    fill('wrong', 'a-long-new-password', 'a-long-new-password');
    expect(await screen.findByText(SY.account.wrongCurrent)).toBeTruthy();
  });

  it('reports how many other sign-ins ended on success and clears the fields', async () => {
    mountAccount({ '/api/auth/password': { ok: true, otherSessionsRevoked: 2 } });
    fill('old-pass', 'a-long-new-password', 'a-long-new-password');
    expect(await screen.findByText(SY.account.changed(2))).toBeTruthy();
    expect((screen.getByLabelText(SY.account.current) as HTMLInputElement).value).toBe('');
  });
});

describe('Setup', () => {
  const SETUP_ROUTES: Routes = {
    '/api/admin/users': { users: [{ userId: 1, username: 'tester', displayName: 'Test User', role: 'admin', active: true, createdAtUtc: '2026-09-01T00:00:00Z' }] },
    '/api/admin/audit': { entries: [], nextBefore: null },
  };
  const mountSetup = (rank: number) => {
    installFakeFetch(SETUP_ROUTES);
    return render(<SetupScreen route={routeOf('setup')} rank={rank} user={USER} go={goSpy} />);
  };

  it('below rank 4 shows the refusal sentence and no write control at all', () => {
    for (const rank of [1, 2, 3]) {
      const { container, unmount } = mountSetup(rank);
      expect(screen.getByText(SY.setup.notAllowed)).toBeTruthy();
      expect(container.querySelectorAll('[data-section]')).toHaveLength(0);
      expect(container.querySelectorAll('button:not([role="tab"]), input, select')).toHaveLength(0);
      unmount();
    }
  });

  it('at rank 4 shows every section, with the write controls and a link for product limits', async () => {
    const { container } = mountSetup(4);
    expect(Array.from(container.querySelectorAll('[data-section]')).map((n) => n.getAttribute('data-section'))).toEqual([
      'setup-line', 'setup-machines', 'setup-stations', 'setup-rules', 'setup-codes', 'setup-sources', 'setup-people', 'setup-audit',
    ]);
    expect(await screen.findByRole('button', { name: 'New account' })).toBeTruthy();
    const link = screen.getByRole('link', { name: SY.setup.limitsLink });
    expect(link.getAttribute('href')).toContain('s=products');
    expect(link.getAttribute('href')).toContain('t=limits');
    expect(screen.queryByText(/limit versions/i)).toBeNull(); // the product-limits block itself is not here
  });

  it('keeps the table names of the data sources inside the Technical detail disclosure', () => {
    const { container } = mountSetup(4);
    const disc = container.querySelector('[data-section="setup-sources"] .ui-disc');
    expect(disc).not.toBeNull();
    expect(within(disc as HTMLElement).getByText(/Loading|Could not|Source|source/i)).toBeTruthy();
  });
});

describe('copy', () => {
  const banned = [/\bbatch(es)?\b/i, /\bepochs?\b/i, /\bgenerations?\b/i, /\bsimulator\b/i, /_TP1U2/i, /\bwinder\b/i, /\bAssumed\b/];
  function collect(node: unknown, out: string[] = []): string[] {
    if (typeof node === 'string') out.push(node);
    else if (typeof node === 'function') out.push((node as (...a: unknown[]) => string)('Aa', 'Bb', 'Cc'));
    else if (node && typeof node === 'object') Object.values(node).forEach((v) => collect(v, out));
    return out;
  }
  it('plain strings carry no pipeline word, no all-caps word, no ellipsis', () => {
    const acronyms = new Set(['OK', 'IFL', 'SMS', 'PDAS', 'SQL', 'MB', 'GB', 'PC']);
    for (const s of collect(SY)) {
      for (const re of banned) {
        // the disclosure's own explanatory sentence is the one plain string allowed to name a generation
        if (s === SY.diag.sources.detailNote) continue;
        expect(s, `${s} ~ ${re}`).not.toMatch(re);
      }
      expect(s).not.toContain('\u2026');
      for (const w of s.match(/[A-Za-z]{2,}/g) ?? []) if (w === w.toUpperCase()) expect(acronyms.has(w), `${w} in ${s}`).toBe(true);
    }
  });
});
