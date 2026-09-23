/**
 * Shared measurement helper for the WS-PW layout harness. One job: read
 * `scrollWidth` vs `clientWidth` off a real element in a real browser —
 * the thing jsdom cannot do at all (jsdom computes no layout, so every
 * value it would report for these is hardcoded/zero, not measured).
 */
import type { Locator } from '@playwright/test';

export interface OverflowMeasurement {
  scrollWidth: number;
  clientWidth: number;
  overflowPx: number;
  overflows: boolean;
}

export async function measureHorizontalOverflow(locator: Locator): Promise<OverflowMeasurement> {
  const { scrollWidth, clientWidth } = await locator.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  return {
    scrollWidth,
    clientWidth,
    overflowPx: Math.max(0, scrollWidth - clientWidth),
    overflows: scrollWidth > clientWidth,
  };
}
