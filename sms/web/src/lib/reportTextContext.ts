/**
 * Wording the redesign (web-next) can replace in the old report renderers, the same way fmtContext.ts swaps date formats.
 * The DEFAULT is null = "use the old text", so the old app, which never mounts a provider, prints exactly what it printed.
 */
import { createContext, useContext } from 'react';
import type { ReportHeader } from '../api';

/** Returns the sentence for a header that spans data batches or comes from the simulator, or null for none. */
export type DisclosureText = (h: ReportHeader) => string | null;

export const DisclosureTextContext = createContext<DisclosureText | null>(null);

export function useDisclosureOverride(): DisclosureText | null {
  return useContext(DisclosureTextContext);
}
