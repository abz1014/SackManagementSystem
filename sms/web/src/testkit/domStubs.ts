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
