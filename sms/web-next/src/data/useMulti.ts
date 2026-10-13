import type { DataState, DataStatus } from './useData';

export interface MultiState {
  /** 'error' if any part failed (see `failed`); 'loading' until all settled; 'empty' only if every part is empty; else 'ok'. */
  status: DataStatus;
  /** Names of the parts that failed, never merged as zero. */
  failed: string[];
  parts: Record<string, DataState<unknown>>;
}

/** Combine named useData results. Call with a stable set of keys. */
export function useMulti(parts: Record<string, DataState<unknown>>): MultiState {
  const entries = Object.entries(parts);
  const failed = entries.filter(([, p]) => p.status === 'error').map(([, p]) => p.part);
  let status: DataStatus;
  if (entries.some(([, p]) => p.status === 'loading')) status = 'loading';
  else if (failed.length > 0) status = 'error';
  else if (entries.length > 0 && entries.every(([, p]) => p.status === 'empty')) status = 'empty';
  else status = 'ok';
  return { status, failed, parts };
}
