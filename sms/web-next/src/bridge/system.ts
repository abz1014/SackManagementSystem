/**
 * Bridge for System > Setup (E12). The Setup sections hold the live admin write logic (what is sent, what the
 * server answers, the no-optimistic-UI rule), so they are reused as they are and restyled by screens/System/Setup/legacy.css.
 * People and AuditLog live in the old Setup.tsx; the product-limits block is left out (Products > Limits owns it).
 */
export { People, AuditLog } from '../../../web/src/screens/Setup';
export { LineBlock } from '../../../web/src/screens/setup/LineBlock';
export { MachinesBlock } from '../../../web/src/screens/setup/MachinesBlock';
export { StationsBlock } from '../../../web/src/screens/setup/StationsBlock';
export { SourcesBlock } from '../../../web/src/screens/setup/SourcesBlock';
export { RulesBlock } from '../../../web/src/screens/setup/RulesBlock';
export { RejectCodesBlock } from '../../../web/src/screens/setup/RejectCodesBlock';
export { dqRawTableFor } from '../../../web/src/screens/health/SyncHealthBlock';
