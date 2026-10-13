/**
 * Component gallery: every component in every state, on one page, for review and for the layout checks.
 * Not wired into App.tsx; the build step that exposes it (dev only, ?s=gallery) is a later task.
 *
 * Station figures are the real ones for production day 1 Sep 2026 (galleryData.ts, taken from
 * design/redesign-2026-10/mockup-data.json). Everything here uses the same components and tokens as the
 * product; nothing in this file is product copy, so its labels are plain strings.
 */
import { useState, type ReactNode } from 'react';
import { BarChart, Histogram, LineChart, Pareto, Sparkline } from './charts';
import { Chip } from './ui/Chip';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { DataTable, type Column, type SortState } from './ui/DataTable';
import { Disclosure } from './ui/Disclosure';
import { EmptyState } from './ui/EmptyState';
import { ErrorState } from './ui/ErrorState';
import { NumberField, ReasonField, SelectField } from './ui/Field';
import { HealthDot } from './ui/HealthDot';
import { Icon, ICON_NAMES } from './ui/Icon';
import { KpiCard } from './ui/KpiCard';
import { PeriodChip } from './ui/PeriodChip';
import { Segmented } from './ui/Segmented';
import { Sheet } from './ui/Sheet';
import { Sidebar } from './ui/Sidebar';
import { Skeleton } from './ui/Skeleton';
import { StationHeatGrid } from './ui/StationHeatGrid';
import { StatusPill, type UiState } from './ui/StatusPill';
import { TabBar } from './ui/TabBar';
import { Tabs } from './ui/Tabs';
import { ToastProvider, useToast } from './ui/Toast';
import { TopBar } from './ui/TopBar';
import { AttentionList } from './ui/AttentionList';
import { Wizard } from './ui/Wizard';
import { WriteGate } from './ui/WriteGate';
import type { Route } from './route';
import {
  GALLERY_HISTOGRAM,
  GALLERY_HOURLY_FAILED_PCT,
  GALLERY_HOURS,
  GALLERY_LIMITS,
  GALLERY_PARETO,
  GALLERY_STATIONS,
} from './galleryData';
import './gallery.css';

const STATES: UiState[] = ['ok', 'watch', 'act', 'nodata'];
const ROUTE: Route = { s: 'today', t: null, sheet: null, wall: false, keys: {} };
const USER = { username: 'asma', displayName: 'Asma', role: 'manager' };
const noop = () => {};

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="gal-block" aria-labelledby={`gal-${id}`}>
      <h2 id={`gal-${id}`} className="gal-h">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gal-row">
      <div className="gal-label">{label}</div>
      <div className="gal-items">{children}</div>
    </div>
  );
}

function ToastDemo() {
  const push = useToast();
  return (
    <div className="gal-items">
      <button type="button" className="ui-btn" onClick={() => push('Published.')}>Show a toast</button>
      <button type="button" className="ui-btn" onClick={() => push('Limits changed.', { action: { label: 'Undo', onClick: noop } })}>
        Show a toast with an action
      </button>
    </div>
  );
}

interface DemoRow { station: number; cones: number; failedPct: number | null }
const TABLE_COLUMNS: Column<DemoRow>[] = [
  { key: 'station', header: 'Station', render: (r) => `Station ${r.station}`, sortValue: (r) => r.station },
  { key: 'cones', header: 'Cones', numeric: true, render: (r) => r.cones.toLocaleString('en-GB'), sortValue: (r) => r.cones },
  { key: 'failed', header: 'Failed inspection', numeric: true, render: (r) => (r.failedPct == null ? 'No data' : `${r.failedPct.toFixed(1)}%`), sortValue: (r) => r.failedPct },
];
const TABLE_ROWS: DemoRow[] = GALLERY_STATIONS.filter((s) => s.cones > 0).map((s) => ({ station: s.station, cones: s.cones, failedPct: s.failedPct }));

function TableDemo() {
  const [sort, setSort] = useState<SortState | null>(null);
  return (
    <DataTable
      caption="Stations on 1 Sep 2026"
      columns={TABLE_COLUMNS}
      rows={TABLE_ROWS}
      rowKey={(r) => String(r.station)}
      sort={sort}
      onSortChange={setSort}
      onRowOpen={noop}
    />
  );
}

function WizardDemo() {
  const [i, setI] = useState(0);
  const [reason, setReason] = useState('');
  return (
    <Wizard
      steps={[{ id: 'what', label: 'What' }, { id: 'why', label: 'Why' }, { id: 'check', label: 'Check' }]}
      current={i}
      onStep={setI}
      nextBlockedReason={i === 1 && reason.trim().length < 10 ? 'Write a reason first.' : null}
      finalAction={<button type="button" className="wr-btn wr-btn--primary">Publish</button>}
    >
      {i === 0 && <p>Choose the change.</p>}
      {i === 1 && <ReasonField label="Reason" value={reason} onChange={setReason} />}
      {i === 2 && <p>Review the change, then publish.</p>}
    </Wizard>
  );
}

export function Gallery() {
  const [tab, setTab] = useState('weight');
  const [seg, setSeg] = useState('shift');
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [num, setNum] = useState('1960');
  const [sel, setSel] = useState('');
  const [chips, setChips] = useState(['Station 8', 'Tube 2 - Mat 1']);

  const spark = GALLERY_HOURLY_FAILED_PCT;
  return (
    <ToastProvider>
      <div className="gal">
        <h1 className="gal-title">Component gallery</h1>
        <p className="gal-note">Every component in every state. Figures are the real ones for 1 Sep 2026.</p>

        <Block id="shell" title="Shell">
          <Row label="Sidebar, open and collapsed">
            <div className="gal-frame"><Sidebar route={ROUTE} rank={4} collapsed={false} onCollapsedChange={noop} onNavigate={noop} /></div>
            <div className="gal-frame"><Sidebar route={ROUTE} rank={1} collapsed onCollapsedChange={noop} onNavigate={noop} /></div>
          </Row>
          <Row label="Top bar with period chip and health dot">
            <div className="gal-wide">
              <TopBar
                title="Today"
                user={USER}
                onOpenAccount={noop}
                onSignOut={noop}
                periodChip={<PeriodChip />}
                healthDot={<HealthDot health={{ kind: 'ok', readingUtc: '2026-09-01T21:59:57Z', lagSeconds: 617 }} plantNowUtc="2026-09-01T21:59:59Z" onOpen={noop} />}
              />
            </div>
          </Row>
          <Row label="Health dot, each verdict">
            <HealthDot health={{ kind: 'ok', readingUtc: '2026-09-01T21:59:57Z', lagSeconds: 617 }} plantNowUtc="2026-09-01T21:59:59Z" onOpen={noop} />
            <HealthDot health={{ kind: 'late', readingUtc: '2026-09-01T21:00:00Z', lagSeconds: 3600 }} plantNowUtc="2026-09-01T21:59:59Z" onOpen={noop} />
            <HealthDot health={{ kind: 'stale', readingUtc: '2026-09-01T18:00:00Z', syncAgeSeconds: 14400 }} plantNowUtc="2026-09-01T21:59:59Z" onOpen={noop} />
            <HealthDot health={null} onOpen={noop} />
          </Row>
          <Row label="Phone tab bar">
            <TabBar route={ROUTE} rank={2} onNavigate={noop} onSignOut={noop} />
          </Row>
          <Row label="Icons">
            {ICON_NAMES.map((n) => (
              <span key={n} className="gal-icon" title={n}><Icon name={n} size={20} /></span>
            ))}
          </Row>
        </Block>

        <Block id="state" title="State vocabulary">
          <Row label="Status pill, full">
            {STATES.map((s) => <StatusPill key={s} state={s} />)}
          </Row>
          <Row label="Status pill, with noun and compact">
            <StatusPill state="act" noun="Station 8" />
            {STATES.map((s) => <StatusPill key={s} state={s} compact />)}
          </Row>
          <Row label="Attention list">
            <AttentionList
              items={[
                { id: 1, state: 'act', sentence: 'Station 8 failed inspection on 54% of cones.', time: '07:12' },
                { id: 2, state: 'watch', sentence: 'Station 13 has only 82 cones this day.', time: '09:40' },
              ]}
              onOpen={noop}
            />
            <AttentionList items={[]} />
          </Row>
        </Block>

        <Block id="kpi" title="KPI cards">
          <div className="gal-kpis">
            <KpiCard label="Cones produced" value="3,089" icon={<Icon name="weight" size={18} />} status="ok" />
            <KpiCard label="Failed inspection" value="14.6" unit="%" state="act" delta={{ text: '2.1 pt', direction: 'up', vs: 'vs previous' }} chip={2} icon={<Icon name="rejects" size={18} />} />
            <KpiCard label="Average cone" value="1,954" unit="g" state="watch" delta={{ text: '1.2 g', direction: 'down', vs: 'vs previous' }} chip={3} icon={<Icon name="weight" size={18} />} />
            <KpiCard label="Sacks packed" value="133" state="ok" delta={{ text: '0 sacks', direction: 'flat', vs: 'vs previous' }} chip={4} icon={<Icon name="sacks" size={18} />} />
            <KpiCard label="Cones produced" status="loading" />
            <KpiCard label="Cones produced" status="empty" />
            <KpiCard label="Cones produced" status="error" part="the cone count" onRetry={noop} />
            <KpiCard label="Failed inspection" value="No data" state="nodata" />
          </div>
        </Block>

        <Block id="grid" title="Station heat grid">
          <Row label="Worst first (1 Sep 2026)">
            <div className="gal-wide"><StationHeatGrid stations={GALLERY_STATIONS} onOpen={noop} /></div>
          </Row>
          <Row label="By station number">
            <div className="gal-wide"><StationHeatGrid stations={GALLERY_STATIONS} onOpen={noop} sort="number" /></div>
          </Row>
        </Block>

        <Block id="charts" title="Charts">
          <div className="gal-charts">
            <Pareto chartId="gal-pareto" title="Reject reasons" unit="cones" rows={GALLERY_PARETO} caption="1 Sep 2026" />
            <Histogram chartId="gal-hist" title="Cone weight" unit="cones" valueUnit="g" bins={GALLERY_HISTOGRAM} limits={GALLERY_LIMITS} caption="1 Sep 2026" />
            <LineChart
              chartId="gal-line"
              title="Failed inspection by hour"
              unit="%"
              categories={GALLERY_HOURS}
              series={[{ name: 'Failed inspection', values: spark }]}
              limits={{ lower: 0, upper: 20, lowerText: '0%', upperText: '20%' }}
              zeroBase
              caption="1 Sep 2026"
            />
            <BarChart
              chartId="gal-bar"
              title="Cones by station"
              unit="cones"
              categories={GALLERY_STATIONS.filter((s) => s.cones > 0).map((s) => `S${s.station}`)}
              series={[{ name: 'Cones', values: GALLERY_STATIONS.filter((s) => s.cones > 0).map((s) => s.cones) }]}
              caption="1 Sep 2026"
            />
            <BarChart
              chartId="gal-bar2"
              title="Cones and failures by station"
              unit="cones"
              categories={GALLERY_STATIONS.filter((s) => s.cones > 0).map((s) => `S${s.station}`)}
              series={[
                { name: 'Cones', values: GALLERY_STATIONS.filter((s) => s.cones > 0).map((s) => s.cones) },
                { name: 'Failed', values: GALLERY_STATIONS.filter((s) => s.cones > 0).map((s) => Math.round((s.failedPct! * s.cones) / 100)) },
              ]}
            />
            <div className="card gal-spark">
              <Sparkline label="Failed inspection by hour" unit="%" values={spark} categories={GALLERY_HOURS} />
              <Sparkline label="Loading" unit="%" values={[]} status="loading" />
              <Sparkline label="Empty" unit="%" values={[null, null]} status="empty" />
            </div>
          </div>
          <Row label="Chart states">
            <BarChart chartId="gal-s-load" title="Loading" unit="cones" categories={[]} series={[]} status="loading" />
            <BarChart chartId="gal-s-err" title="Error" unit="cones" categories={[]} series={[]} status="error" errorPart="the station chart" onRetry={noop} />
            <BarChart chartId="gal-s-empty" title="Empty" unit="cones" categories={[]} series={[]} status="empty" emptyAction={{ label: 'Show 7 Sep 2026', onClick: noop }} />
          </Row>
        </Block>

        <Block id="data" title="Data table">
          <TableDemo />
          <Row label="Loading, empty, error">
            <div className="gal-wide"><DataTable caption="Loading" columns={TABLE_COLUMNS} rows={[]} rowKey={(r) => String(r.station)} loading /></div>
            <div className="gal-wide"><DataTable caption="Empty" columns={TABLE_COLUMNS} rows={[]} rowKey={(r) => String(r.station)} /></div>
            <div className="gal-wide"><DataTable caption="Error" columns={TABLE_COLUMNS} rows={[]} rowKey={(r) => String(r.station)} error={<ErrorState part="the station table" onRetry={noop} />} /></div>
          </Row>
        </Block>

        <Block id="nav" title="Tabs, segmented control, chips, disclosure">
          <Row label="Tabs">
            <Tabs label="Quality" value={tab} onChange={setTab} items={[{ id: 'weight', label: 'Weight' }, { id: 'rejects', label: 'Rejects' }, { id: 'stations', label: 'Stations' }, { id: 'register', label: 'Register', disabled: true }]} />
          </Row>
          <Row label="Segmented">
            <Segmented label="Group by" value={seg} onChange={setSeg} options={[{ id: 'shift', label: 'Shift' }, { id: 'day', label: 'Day' }, { id: 'station', label: 'Station', disabledReason: 'Pick one day first.' }]} />
          </Row>
          <Row label="Chips">
            {chips.map((c) => <Chip key={c} onRemove={() => setChips((x) => x.filter((y) => y !== c))}>{c}</Chip>)}
            <Chip>Fixed filter</Chip>
          </Row>
          <Row label="Disclosure">
            <Disclosure id="gallery-how"><p>Failed inspection is the share of cones that failed the inspection, out of all cones weighed.</p></Disclosure>
          </Row>
        </Block>

        <Block id="states" title="Empty, error and loading states">
          <div className="gal-three">
            <EmptyState newest="2026-09-07T12:00:00Z" onShowNewest={noop} />
            <EmptyState />
            <ErrorState part="the reject chart" onRetry={noop} />
            <ErrorState part="the reject chart" onRetry={noop} attempts={2} />
            <Skeleton part="the reject chart" height={96} />
            <Skeleton part="the station table" lines={4} />
          </div>
        </Block>

        <Block id="overlays" title="Sheet, toast, dialog">
          <Row label="Sheet">
            <button type="button" className="ui-btn" onClick={() => setSheet(true)}>Open sheet</button>
            <Sheet open={sheet} onClose={() => setSheet(false)} title="Station 8" status={<StatusPill state="act" />} footer={<button type="button" className="ui-btn" onClick={() => setSheet(false)}>Close</button>}>
              <p>Station 8 failed inspection on 54% of 414 cones on 1 Sep 2026.</p>
            </Sheet>
          </Row>
          <Row label="Toast"><ToastDemo /></Row>
          <Row label="Confirm dialog">
            <button type="button" className="ui-btn" onClick={() => setConfirm(true)}>Open dialog</button>
            <ConfirmDialog open={confirm} title="Change limits" confirmLabel="Change limits" onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)}>
              <p>The new limits apply to cones weighed from now on.</p>
            </ConfirmDialog>
          </Row>
        </Block>

        <Block id="write" title="Write controls">
          <Row label="Fields">
            <NumberField label="Target weight" unit="g" value={num} onChange={setNum} min={1000} max={3000} hint="The product target." />
            <NumberField label="Target weight" unit="g" value="" onChange={noop} error="Enter a weight." />
            <SelectField label="Product" value={sel} onChange={setSel} placeholder="Choose a product" options={[{ value: '12', label: '201-IH0-SD' }, { value: '20', label: '205-IL0-SD' }]} />
            <ReasonField label="Reason" value="" onChange={noop} />
          </Row>
          <Row label="Wizard"><div className="gal-wide"><WizardDemo /></div></Row>
          <Row label="Write gate, below rank (absent)">
            <WriteGate rank={1} minRank={2}><button type="button" className="ui-btn">Change limits</button></WriteGate>
            <span className="gal-note">Nothing is drawn below the rank.</span>
          </Row>
          <Row label="Write gate, writes off (disabled with the server reason)">
            <WriteGate rank={2} minRank={2} disabledReason="PDAS_WRITE_ENABLED is not true."><button type="button" className="ui-btn">Change limits</button></WriteGate>
          </Row>
          <Row label="Write gate, writes on">
            <WriteGate rank={2} minRank={2}><button type="button" className="ui-btn">Change limits</button></WriteGate>
          </Row>
        </Block>
      </div>
    </ToastProvider>
  );
}
