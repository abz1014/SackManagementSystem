/**
 * App shell for the "Light Steel" rework — icon rail, section column, content.
 *
 * Extracted from App.tsx rather than added to it: App.tsx is already ~5,000
 * lines and the shell is the one piece every screen depends on, so it is the
 * part worth being able to read on its own.
 *
 * Layout is 92px rail / 250px section column / 1fr content, full viewport
 * height, and ONLY the content column scrolls. The rail and column stay put at
 * every width, which is what makes this feel like an instrument panel rather
 * than a web page.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ROLE_RANK, type AuthUser, type Meta } from './api';
import { ageLabel, freshnessLevel } from './format';

/* ------------------------------------------------------------------ views */

export type View =
  | 'now'
  | 'sacks'
  | 'cones'
  | 'report'
  | 'wall'
  | 'dashboard'
  | 'register'
  | 'performance'
  | 'weight'
  | 'rejects'
  | 'shift'
  | 'operations'
  | 'exceptions'
  | 'timeline'
  | 'admin';

/**
 * Minimum role rank per view, enforced in BOTH directions: the rail hides what
 * a role cannot open, and the router refuses it too.
 *
 * Hiding a nav button is decluttering, not access control — `?v=weight` typed
 * by hand would still render for an operator, and today `?v=admin` already
 * does exactly that (it renders and then every call 403s, which reads as a
 * broken page rather than a denial). The guard is what makes this real.
 *
 * This is intentionally NOT a security boundary on its own: the API enforces
 * the same ranks server-side. It stops a role seeing a screen it has no
 * business in; it is not what stops them reading the data.
 */
/**
 * Floor screens (Now, Sacks, Cones, Wall) are for everyone. The analysis
 * screens — the whole app until 2 Sep 2026 — moved behind the manager role
 * after IFL's first review: a shift supervisor landing on SPC charts and OEE
 * decompositions was the complaint. ANALYSIS_MIN_RANK is the one knob if
 * that call is revisited.
 */
export const ANALYSIS_MIN_RANK = 3;
export const VIEW_MIN_RANK: Record<View, number> = {
  now: 1,
  sacks: 1,
  cones: 1,
  // Everyone. "How much did we make today" is as much a floor question as a
  // management one, and the report shows only figures the floor screens
  // already display, aggregated.
  report: 1,
  wall: 1,
  dashboard: ANALYSIS_MIN_RANK, // Line
  register: ANALYSIS_MIN_RANK, // Records
  shift: ANALYSIS_MIN_RANK, // Shifts
  performance: ANALYSIS_MIN_RANK, // Output
  weight: ANALYSIS_MIN_RANK,
  rejects: ANALYSIS_MIN_RANK,
  exceptions: ANALYSIS_MIN_RANK, // reached from Line's findings; no rail item
  operations: 1, // reachable by anyone via the sync footer; no rail item
  // The current product and its changeover history are shown to every role
  // on the Now screen's product bar; the history page discloses nothing new.
  timeline: 1, // reached via "View history"; no rail item
  admin: 4, // Setup — admin only
};

export const canOpen = (view: View, rank: number) => rank >= VIEW_MIN_RANK[view];

/** Short, plain rail labels — the design deliberately renames the old ones. */
export const VIEW_LABEL: Record<View, string> = {
  now: 'Now',
  sacks: 'Sacks',
  cones: 'Cones',
  report: 'Report',
  wall: 'Wall',
  dashboard: 'Line',
  register: 'Records',
  performance: 'Output',
  weight: 'Weight',
  rejects: 'Rejects',
  shift: 'Shifts',
  operations: 'Sync',
  exceptions: 'Exceptions',
  timeline: 'Product history',
  admin: 'Setup',
};

/* ------------------------------------------------------------------ glyphs */

/**
 * Rail glyphs, lifted verbatim from the design file: 24×24, stroked,
 * currentColor, 1.8 stroke-width.
 *
 * The Setup glyph's three knobs are drawn as filled circles that mask the line
 * behind them (it is a sliders icon). The design file hardcodes that fill to
 * #16191C, which is the rail's own background — invisible against anything
 * else, and wrong on the active state where the surface is lighter. They are
 * bound to a CSS variable here so the mask always matches the surface it sits on.
 */
const GLYPH: Record<View, ReactNode> = {
  // Floor glyphs, drawn in the same 24×24 / 1.8-stroke idiom as the rest.
  now: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" strokeLinecap="round" strokeLinejoin="round" />,
  sacks: (
    <>
      <path d="M9 4h6l-1.5 3.5c3 1.4 4.5 4.3 4.5 7.5a6 6 0 0 1-12 0c0-3.2 1.5-6.1 4.5-7.5Z" strokeLinejoin="round" />
      <path d="M9.5 7.5h5" opacity="0.5" />
    </>
  ),
  cones: (
    <>
      <path d="M9.5 4h5l2 15h-9z" strokeLinejoin="round" />
      <path d="M8.3 12.5h7.4" opacity="0.5" />
    </>
  ),
  report: (
    <>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
      <path d="M9 17v-3M12 17v-6M15 17v-4" strokeLinecap="round" />
    </>
  ),
  wall: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 17v3" strokeLinecap="round" />
    </>
  ),
  dashboard: (
    <>
      <path d="M3 13a9 9 0 0 1 18 0" />
      <path d="M12 13l4.5-4" strokeLinecap="round" />
      <circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none" />
      <path d="M3 18h18" opacity="0.4" />
    </>
  ),
  register: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M3 15h18M9.5 9.5V20" />
    </>
  ),
  performance: <path d="M4 20V11M9.3 20V5M14.7 20v-6M20 20V8" strokeLinecap="round" />,
  weight: (
    <>
      <path d="M3 18c3.6 0 3.2-11 9-11s5.4 11 9 11" strokeLinecap="round" />
      <path d="M12 4.5V7" opacity="0.5" />
    </>
  ),
  rejects: (
    <>
      <path d="M12 4.5 21 19H3z" strokeLinejoin="round" />
      <path d="M12 10v4" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  shift: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.4 2.1" strokeLinecap="round" />
    </>
  ),
  operations: (
    <>
      <path d="M12 3a9 9 0 1 1-9 9" strokeLinecap="round" />
      <path d="M12 3l3.2 2.6L12 8.2" strokeLinejoin="round" />
    </>
  ),
  // Never rendered — like operations, exceptions has no RAIL entry (reachable
  // via the "See all" link on Overview's findings panel instead). Reuses the
  // rejects triangle-alert shape rather than inventing a new glyph outside
  // the design file, since GLYPH is a Record<View,...> and every key needs one.
  exceptions: (
    <>
      <path d="M12 4.5 21 19H3z" strokeLinejoin="round" />
      <path d="M12 10v4" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // Never rendered — no RAIL entry (reachable via the "View history →" link
  // on the current-product bar instead). Reuses the shift clock-face shape:
  // a changeover history is a sequence of points in time, same as a shift.
  timeline: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.4 2.1" strokeLinecap="round" />
    </>
  ),
  admin: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2.2" className="knob" stroke="none" />
      <circle cx="15" cy="12" r="2.2" className="knob" stroke="none" />
      <circle cx="7.5" cy="17" r="2.2" className="knob" stroke="none" />
    </>
  ),
};

const SIGN_OUT_GLYPH = (
  <>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <path d="M10 8l-4 4 4 4M6 12h9" strokeLinecap="round" />
  </>
);

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      {children}
    </svg>
  );
}

/**
 * Rail order, in groups. The floor group is everyone's; "Analysis" appears only
 * for roles that can open it (a group with no visible item renders nothing,
 * label included).
 *
 * `performance` (Output) and `shift` (Shifts) were REMOVED from the rail on
 * 2 Sep 2026, after IFL's requirement list was read back against the build.
 * Nothing in that list asks for OEE, availability, performance, quality,
 * downtime, stoppage clustering, mean time between failures, or shift-versus-
 * shift comparison. Those five sub-screens answered a question nobody posed,
 * and they carried the charts IFL specifically called unreadable. The routes
 * still resolve, so a typed URL and the existing deep links keep working, but
 * they are no longer part of the product: not in the rail, not in a demo, and
 * not claimed in CAPABILITIES.md. Restoring them is a one-line change here if
 * IFL ever asks for effectiveness reporting.
 *
 * `operations`, `exceptions` and `timeline` are absent for the original
 * reason — reachable routes without rail items, opened from the sync footer,
 * Line's findings and the product bar.
 */
const RAIL_GROUPS: { label: string | null; views: View[] }[] = [
  { label: null, views: ['now', 'sacks', 'cones', 'report', 'wall'] },
  { label: 'Analysis', views: ['dashboard', 'register', 'weight', 'rejects'] },
  { label: null, views: ['admin'] },
];

/* ------------------------------------------------------- section column cfg */

export interface SubTab {
  key: string;
  label: string;
  note?: string;
}
export interface SectionConfig {
  eyebrow: string;
  title: string;
  subTabs: SubTab[];
}

/* -------------------------------------------------------------- components */

function Rail({
  view,
  rank,
  onNavigate,
  onSignOut,
}: {
  view: View;
  rank: number;
  onNavigate: (v: View) => void;
  onSignOut: () => void;
}) {
  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail-mark">SMS</div>
      <div className="rail-items">
        {RAIL_GROUPS.map((g, gi) => {
          const items = g.views.filter((v) => canOpen(v, rank));
          if (items.length === 0) return null;
          return (
            <div className="rail-group" key={gi}>
              {g.label && <div className="rail-group-label">{g.label}</div>}
              {items.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`rail-btn${view === v ? ' active' : ''}`}
                  aria-current={view === v ? 'page' : undefined}
                  onClick={() => onNavigate(v)}
                >
                  <Glyph>{GLYPH[v]}</Glyph>
                  <span className="rail-label">{VIEW_LABEL[v]}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <button type="button" className="rail-btn rail-out" onClick={onSignOut}>
        <Glyph>{SIGN_OUT_GLYPH}</Glyph>
        <span className="rail-label">Out</span>
      </button>
    </nav>
  );
}

/**
 * Text-size control. The design removes it; it is kept because "the text is too
 * small" is the client's standing complaint and the fix that answered it was
 * making size a setting rather than our guess.
 *
 * It lives in the section-column footer rather than the design's suggested
 * "Setup preference" because Setup is admin-only — the wall-screen operator,
 * the one user who actually needs this, could never reach it there. That is a
 * contradiction inside the handoff, not a preference.
 *
 * Labelled by environment rather than by letter height, and 1.0-and-up only:
 * a sub-1.0 step would drop the 30px alarm verdict figures under 24px and void
 * their large-text contrast exemption.
 */
const SCALES = [
  { key: '1', label: 'Desk' },
  { key: '1.15', label: 'Floor' },
  { key: '1.3', label: 'Wall' },
] as const;

function TextSize() {
  const [scale, setScale] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('sms.uiScale') : null;
    return SCALES.some((s) => s.key === saved) ? saved! : '1';
  });
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', scale);
    try {
      localStorage.setItem('sms.uiScale', scale);
    } catch {
      /* private mode — the choice just will not persist */
    }
  }, [scale]);
  return (
    <div className="col-textsize" role="group" aria-label="Text size">
      <span className="cts-label">Text size</span>
      <span className="cts-opts">
        {SCALES.map((s) => (
          <button
            key={s.key}
            type="button"
            className={scale === s.key ? 'active' : ''}
            aria-pressed={scale === s.key}
            onClick={() => setScale(s.key)}
          >
            {s.label}
          </button>
        ))}
      </span>
    </div>
  );
}

function SectionColumn({
  config,
  sub,
  onSub,
  user,
  freshness,
  productLabel,
  onOpenSync,
}: {
  config: SectionConfig;
  sub: string;
  onSub: (k: string) => void;
  user: AuthUser;
  freshness: Meta | null;
  productLabel: string | null;
  onOpenSync: () => void;
}) {
  const initials = (user.displayName ?? user.username)
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="column">
      <div className="col-head">
        <div className="col-eyebrow">{config.eyebrow}</div>
        <h1 className="col-title">{config.title}</h1>
      </div>

      {config.subTabs.length > 0 && (
        <div className="col-tabs" role="tablist" aria-label={`${config.title} views`}>
          {config.subTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={sub === t.key}
              className={`col-tab${sub === t.key ? ' active' : ''}`}
              onClick={() => onSub(t.key)}
            >
              <span className="ct-label">{t.label}</span>
              {t.note && <span className="ct-note">{t.note}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="col-foot">
        {productLabel && (
          <div className="col-running">
            <div className="cr-eyebrow">Running now</div>
            <div className="cr-product">{productLabel}</div>
          </div>
        )}

        {/* The fastest answer to "is this number stale?", for every role — which
            is why it stays a button and why Sync is reachable without a rail
            item or an admin-only Setup tab. */}
        <button type="button" className="col-sync" onClick={onOpenSync} title="Open sync status">
          <span className={`dot ${freshness ? freshnessLevel(freshness.sourceAgeSeconds) : 'crit'}`} />
          synced {freshness ? ageLabel(freshness.sourceAgeSeconds) : '—'}
        </button>

        <TextSize />

        <div className="col-user">
          <span className="cu-tile" aria-hidden="true">{initials}</span>
          <span className="cu-who">
            <span className="cu-name">{user.displayName ?? user.username}</span>
            <span className="cu-role">{user.role}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  view,
  rank,
  user,
  freshness,
  productLabel,
  section,
  sub,
  onNavigate,
  onSub,
  onSignOut,
  onOpenSync,
  children,
}: {
  view: View;
  rank: number;
  user: AuthUser;
  freshness: Meta | null;
  productLabel: string | null;
  section: SectionConfig;
  sub: string;
  onNavigate: (v: View) => void;
  onSub: (k: string) => void;
  onSignOut: () => void;
  onOpenSync: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <Rail view={view} rank={rank} onNavigate={onNavigate} onSignOut={onSignOut} />
      <SectionColumn
        config={section}
        sub={sub}
        onSub={onSub}
        user={user}
        freshness={freshness}
        productLabel={productLabel}
        onOpenSync={onOpenSync}
      />
      <main id="main" className="content" tabIndex={-1}>
        <p className="sr-only" aria-live="polite">{section.title} view</p>
        {children}
      </main>
    </div>
  );
}

export { ROLE_RANK };
