/**
 * Which component draws which (screen, tab), and which draws each sheet kind.
 *
 * E2..E7 REPLACE entries here; nothing else in the frame changes:
 *
 *   import { TodayScreen } from './today/Today';
 *   SCREENS['today/'] = TodayScreen;                 // eager
 *   SCREENS['quality/weight'] = lazy(() => import('./quality/Weight').then((m) => ({ default: m.WeightScreen })));
 *   SHEETS.station = StationSheet;
 *
 * Keys are `${s}/${t ?? ''}` (see screenKey). Wall mode is `today/wall`.
 * Products and PDAS screens must be EAGER: rank.matrix pins their write controls
 * synchronously and a lazy chunk would make that test hollow.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { AuthUser } from '../bridge/api';
import { SCREENS as SCREEN_IDS, TABS, type Route, type SheetKind } from '../route';
import { Placeholder } from './Placeholder';
import { PlaceholderSheet } from './PlaceholderSheet';
import { TodayScreen } from './Today/Today';
import { ProductsBoardScreen } from './Products/Board/ProductsBoard';
import { ProductsCatalogueScreen } from './Products/Catalogue/ProductsCatalogue';
import { ProductsChangeoverScreen } from './Products/Changeover/ChangeoverScreen';
import { ProductsLimitsScreen, ProductsHistoryScreen } from './Products/Limits/LimitsScreen';
import { DiagnosticsScreen, SetupScreen, AccountScreen } from './System';

export interface ScreenProps {
  route: Route;
  /** 1 viewer .. 4 admin. Writes are gated on this by the screen, never the read. */
  rank: number;
  user: AuthUser;
  /** Navigate: pushes a history entry, or replaces it with { replace: true } (pagers, steppers). */
  go: (next: Route, opts?: { replace?: boolean }) => void;
}
export interface SheetProps extends ScreenProps {
  /** Close = remove `sheet` from the URL. */
  onClose: () => void;
}

export type ScreenComponent = ComponentType<ScreenProps> | LazyExoticComponent<ComponentType<ScreenProps>>;
export type SheetComponent = ComponentType<SheetProps> | LazyExoticComponent<ComponentType<SheetProps>>;

export const WALL_KEY = 'today/wall';

export function screenKey(r: { s: string; t: string | null; wall?: boolean }): string {
  if (r.wall) return WALL_KEY;
  return `${r.s}/${r.t ?? ''}`;
}

/** Every key the route model can produce. */
export const SCREEN_KEYS: string[] = [
  ...SCREEN_IDS.flatMap((s) => {
    const tabs = (TABS as Partial<Record<string, readonly string[]>>)[s];
    return tabs ? tabs.map((t) => `${s}/${t}`) : [`${s}/`];
  }),
  WALL_KEY,
];

export const SCREENS: Record<string, ScreenComponent> = Object.fromEntries(
  SCREEN_KEYS.map((k) => [k, Placeholder]),
);

// Today is eager (the landing page); Quality, Wall and the sheets are separate chunks.
SCREENS['today/'] = TodayScreen;
SCREENS['today/wall'] = lazy(() => import('./Wall/Wall').then((m) => ({ default: m.WallScreen })));
SCREENS['quality/stations'] = lazy(() => import('./Quality/Stations').then((m) => ({ default: m.QualityStationsScreen })));
SCREENS['quality/weight'] = lazy(() => import('./Quality/Weight/WeightScreen').then((m) => ({ default: m.QualityWeightScreen })));
SCREENS['quality/rejects'] = lazy(() => import('./Quality/Rejects/QualityRejects').then((m) => ({ default: m.QualityRejectsScreen })));
SCREENS['quality/register'] = lazy(() => import('./Quality/Register/QualityRegister').then((m) => ({ default: m.QualityRegisterScreen })));

// Products & PDAS and System are EAGER (rank.matrix pins their write controls synchronously).
SCREENS['products/board'] = ProductsBoardScreen;
SCREENS['products/catalogue'] = ProductsCatalogueScreen;
SCREENS['products/changeover'] = ProductsChangeoverScreen;
SCREENS['products/limits'] = ProductsLimitsScreen;
SCREENS['products/history'] = ProductsHistoryScreen;
SCREENS['reports/'] = lazy(() => import('./Reports').then((m) => ({ default: m.ReportsScreen })));
SCREENS['system/diagnostics'] = DiagnosticsScreen;
SCREENS['system/setup'] = SetupScreen;
SCREENS['system/account'] = AccountScreen;

export const SHEETS: Partial<Record<SheetKind, SheetComponent>> = {
  station: lazy(() => import('../sheets/StationSheet/StationSheet').then((m) => ({ default: m.StationSheet }))),
  cone: lazy(() => import('../sheets/ConeSheet/ConeSheet').then((m) => ({ default: m.ConeSheet }))),
  sack: lazy(() => import('../sheets/SackSheet/SackSheet').then((m) => ({ default: m.SackSheet }))),
  reject: lazy(() => import('../sheets/RejectSheet/RejectSheet').then((m) => ({ default: m.RejectSheet }))),
  stock: lazy(() => import('../sheets/StockSheet/StockSheet').then((m) => ({ default: m.StockSheet }))),
  reason: lazy(() => import('../sheets/ReasonSheet/ReasonSheet').then((m) => ({ default: m.ReasonSheet }))),
};

export function resolveScreen(r: Route): ScreenComponent {
  return SCREENS[screenKey(r)] ?? Placeholder;
}

export function resolveSheet(kind: SheetKind): SheetComponent {
  return SHEETS[kind] ?? PlaceholderSheet;
}
