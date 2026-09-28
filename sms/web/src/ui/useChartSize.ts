/**
 * Chart overhaul wave 1, Task T2. Replaces the fixed-size assumptions in
 * `chart.tsx:28`'s `useChartWidth` with a fuller contract: a width that
 * re-lays out on resize (element AND window — a Wall-mode `--ui-scale`
 * change does not necessarily change the container's own box), a
 * user-draggable height remembered per chart, print behaviour that is a
 * fixed width rather than whatever the container happens to be, and a font
 * size that tracks `--ui-scale` so callers can compute label-fit math
 * (`fittingTicks` in `chart.tsx`) against the size text will actually render
 * at, on the Wall as much as on a desk.
 *
 * `chart.tsx` is NOT owned by this task and is deliberately left untouched.
 * `useChartWidthFromSize` below is exported so whoever next touches
 * `chart.tsx` can swap `useChartWidth`'s body for a thin wrapper around this
 * hook without duplicating the resize/print logic.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface ChartSizeOptions {
  /** Storage key suffix (`sms.chartH.<chartId>`). Height is not persisted without one. */
  chartId?: string;
  /** Height used when nothing is stored, and always used while printing. */
  defaultH: number;
  minH?: number;
  maxH?: number;
  /** Width used when no ResizeObserver is available (jsdom without the test stub) or before the first measurement. */
  fallbackW?: number;
}

export interface ChartSize {
  width: number;
  height: number;
  /** 13px scaled by the numeric `--ui-scale` custom property on `<html>` (Wall mode sets 1.3). */
  fontPx: number;
  print: boolean;
  setHeight: (h: number) => void;
  resetHeight: () => void;
}

const DEFAULT_MIN_H = 160;
const DEFAULT_MAX_H = 720;
const DEFAULT_FALLBACK_W = 1036;
const RESIZE_HYSTERESIS_PX = 1;
const BASE_FONT_PX = 13;
const PRINT_WIDTH_REPORT = 1000;
const PRINT_WIDTH_OTHER = 680;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** `--ui-scale` as a positive finite number, else 1 — never lets a bad value zero out or blow up type size. */
function readUiScale(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale');
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

function readFontPx(): number {
  return BASE_FONT_PX * readUiScale();
}

function storageKey(chartId: string | undefined): string | null {
  return chartId ? `sms.chartH.${chartId}` : null;
}

function readStoredHeight(chartId: string | undefined, defaultH: number, minH: number, maxH: number): number {
  const key = storageKey(chartId);
  if (!key) return clamp(defaultH, minH, maxH);
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return clamp(defaultH, minH, maxH);
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n, minH, maxH) : clamp(defaultH, minH, maxH);
  } catch {
    return clamp(defaultH, minH, maxH);
  }
}

function readPrintMatches(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('print').matches;
  } catch {
    return false;
  }
}

/**
 * True while printing a Report-screen page (`Report.tsx`'s
 * `aria-label="Report"` group inside `<main>`), matching the `report-landscape`
 * `@page` hook `app.css` already keys off the same DOM shape
 * (`print.landscape.guard.test.ts` guards that string elsewhere; this is a
 * second, independent reader of the same markup, not the guarded string
 * itself). `:has()` can throw in older/partial implementations — jsdom does
 * not implement it as of the pinned version — so every probe here is
 * defensive, and a `.report` class is accepted as a fallback hook.
 */
function isReportPrintContext(): boolean {
  try {
    if (document.querySelector('main:has([role="group"][aria-label="Report"])')) return true;
  } catch {
    /* :has unsupported or throws — fall through to the class fallback */
  }
  try {
    if (document.querySelector('.report')) return true;
  } catch {
    /* defensive: querySelector itself should not throw, but never let a
       probe here break chart sizing */
  }
  return false;
}

/**
 * Sizes a chart: a ResizeObserver-driven width (coalesced with
 * `requestAnimationFrame`, ignoring sub-2px jitter so a scrollbar toggling
 * cannot loop), a height the reader can drag and that survives a reload via
 * `localStorage`, a `--ui-scale`-aware font size, and a fixed print width.
 */
export function useChartSize(ref: RefObject<Element | null>, opts: ChartSizeOptions): ChartSize {
  const { chartId, defaultH } = opts;
  const minH = opts.minH ?? DEFAULT_MIN_H;
  const maxH = opts.maxH ?? DEFAULT_MAX_H;
  const fallbackW = opts.fallbackW ?? DEFAULT_FALLBACK_W;

  const [width, setWidth] = useState<number>(fallbackW);
  const [fontPx, setFontPx] = useState<number>(() => readFontPx());
  const [print, setPrint] = useState<boolean>(() => readPrintMatches());
  const [height, setHeightState] = useState<number>(() => readStoredHeight(chartId, defaultH, minH, maxH));

  const lastWidthRef = useRef<number>(fallbackW);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      setWidth(fallbackW);
      return;
    }

    const applyWidth = (w: number) => {
      if (Math.abs(w - lastWidthRef.current) <= RESIZE_HYSTERESIS_PX) return;
      lastWidthRef.current = w;
      setWidth(Math.round(w));
      setFontPx(readFontPx());
    };

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (!w) return;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyWidth(w);
      });
    });
    ro.observe(el);

    const initial = el.getBoundingClientRect().width;
    if (initial > 0) applyWidth(initial);

    return () => {
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [ref, fallbackW]);

  // Window resize also re-reads --ui-scale: a Wall-mode scale change is not
  // guaranteed to change any chart container's own box, so the element
  // ResizeObserver above cannot be relied on alone to catch it.
  useEffect(() => {
    const onResize = () => setFontPx(readFontPx());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let mql: MediaQueryList | null = null;
    try {
      mql = matchMedia('print');
    } catch {
      mql = null;
    }
    const onBeforePrint = () => setPrint(true);
    const onAfterPrint = () => setPrint(false);
    const onChange = (e: MediaQueryListEvent) => setPrint(e.matches);
    try {
      mql?.addEventListener?.('change', onChange);
    } catch {
      /* defensive */
    }
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      try {
        mql?.removeEventListener?.('change', onChange);
      } catch {
        /* defensive */
      }
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);

  const setHeight = useCallback(
    (h: number) => {
      const clamped = clamp(h, minH, maxH);
      setHeightState(clamped);
      const key = storageKey(chartId);
      if (key) {
        try {
          localStorage.setItem(key, String(clamped));
        } catch {
          /* private mode / quota — the drag still works for this session */
        }
      }
    },
    [chartId, minH, maxH],
  );

  const resetHeight = useCallback(() => {
    setHeightState(clamp(defaultH, minH, maxH));
    const key = storageKey(chartId);
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* private mode — nothing was persisted to remove */
      }
    }
  }, [chartId, defaultH, minH, maxH]);

  const printWidth = isReportPrintContext() ? PRINT_WIDTH_REPORT : PRINT_WIDTH_OTHER;

  return {
    width: print ? printWidth : width,
    height: print ? defaultH : height,
    fontPx,
    print,
    setHeight,
    resetHeight,
  };
}

/**
 * `useChartWidth`-shaped wrapper (`chart.tsx:28`'s own return shape: a ref
 * and a width) built on `useChartSize`, for whoever next touches
 * `chart.tsx` to swap in without re-deriving the resize/print logic here.
 * Not called from `chart.tsx` by this task — that file is owned elsewhere.
 */
export function useChartWidthFromSize(fallback = DEFAULT_FALLBACK_W): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useChartSize(ref, { defaultH: 0, fallbackW: fallback });
  return [ref, width];
}
