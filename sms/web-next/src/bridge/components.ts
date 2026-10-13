/**
 * Bridge to existing UI behaviour that web-next reuses as is (decision E-3).
 * The simulator notice and the error boundary carry guard-tested rules
 * (a failed /api/data-batch never claims "real"; a wall display remounts once),
 * so they are reused, not re-implemented.
 */
export { SimulatorBanner } from '../../../web/src/ui/SimulatorBanner';
export { ErrorBoundary } from '../../../web/src/ui/ErrorBoundary';
