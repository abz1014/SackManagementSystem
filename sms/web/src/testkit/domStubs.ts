/**
 * DOM APIs jsdom does not implement, stubbed for component tests. Each stub
 * is cited against the real call site it exists for, so a future reader can
 * tell "this is load-bearing for screen X" from "nobody needs this any more".
 *
 * UX Phase 8 Brief A (21 Sep 2026).
 */

/**
 * jsdom has no layout engine and therefore no `ResizeObserver` — used by
 * `ui/chart.tsx:34` to size the SVG to its container, reached from
 * `Weight.tsx:592,663`, `Rejects.tsx:510` and `report/shared.tsx:113,184`.
 * Without this stub, mounting any screen that renders a chart throws
 * `ReferenceError: ResizeObserver is not defined` before a single assertion
 * runs.
 */
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * jsdom does not implement scroll behaviour, so `Element.prototype.
 * scrollIntoView` is simply absent — called by `product/Catalogue.tsx:139`
 * to bring a newly-selected catalogue row into view. Left as a no-op: no
 * test in this suite asserts on scroll position, only that the call does
 * not throw.
 */
function stubScrollIntoView(): void {}

let installed = false;

/** Idempotent — safe to call from every test file's setup without guarding. */
export function installDomStubs(): void {
  if (installed) return;
  installed = true;
  if (typeof globalThis.ResizeObserver === 'undefined') {
    (globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver = StubResizeObserver;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = stubScrollIntoView;
  }
}

/* ------------------------------------------------- controllable ResizeObserver */

/**
 * `StubResizeObserver` above deliberately never fires its callback — several
 * component tests (`screens/report/histogram.axis.test.tsx` among them) rely
 * on exactly that: they render behind `installDomStubs()` and assert against
 * `useChartWidth`'s untouched fallback width, on the strength of the stub
 * staying silent. That must keep being the default for every test that only
 * calls `installDomStubs()` — this second stub is additive, never installed
 * by `installDomStubs()` itself, and a test opts into it explicitly.
 *
 * `ui/useChartSize.test.tsx` is the reason this exists: its tests need a
 * resize to actually reach the hook's ResizeObserver callback, which the
 * silent stub can never do. Call `installControllableResizeObserver()`
 * before mounting, then `fireResize(el, width)` per observed element to
 * drive it — a no-op if nothing is observing `el`.
 */
const controllableRegistry = new Map<Element, Set<(width: number, height: number) => void>>();

class ControllableResizeObserver implements ResizeObserver {
  private els = new Set<Element>();
  private readonly fire: (width: number, height: number) => void;

  constructor(cb: ResizeObserverCallback) {
    this.fire = (width, height) => {
      for (const el of this.els) {
        const rect = { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 };
        const entry = {
          contentRect: rect,
          target: el,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry;
        cb([entry], this as unknown as ResizeObserver);
      }
    };
  }

  observe(el: Element): void {
    this.els.add(el);
    let set = controllableRegistry.get(el);
    if (!set) {
      set = new Set();
      controllableRegistry.set(el, set);
    }
    set.add(this.fire);
  }

  unobserve(el: Element): void {
    this.els.delete(el);
    controllableRegistry.get(el)?.delete(this.fire);
  }

  disconnect(): void {
    for (const el of this.els) controllableRegistry.get(el)?.delete(this.fire);
    this.els.clear();
  }
}

/**
 * Replaces `globalThis.ResizeObserver` with the controllable stub, for this
 * test file only (module state is per-file under vitest's default
 * isolation). Unconditional — unlike `installDomStubs()`, which only fills
 * in an absent global, this always overwrites, so it must not be called from
 * a file that also needs the silent default (e.g. anything importing
 * `testkit/render`).
 */
export function installControllableResizeObserver(): void {
  (globalThis as unknown as { ResizeObserver: typeof ControllableResizeObserver }).ResizeObserver =
    ControllableResizeObserver;
}

/** Fires a resize to `width`×`height` for every observer currently watching `el`. Silently does nothing if none is. */
export function fireResize(el: Element, width: number, height = 0): void {
  const set = controllableRegistry.get(el);
  if (!set) return;
  for (const fire of set) fire(width, height);
}
