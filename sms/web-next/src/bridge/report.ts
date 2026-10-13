/**
 * Bridge to the existing report machinery (decision E-3: reuse, restyle through classes, never re-implement).
 * Reports (task E11) draws the 18 report bodies with these renderers unchanged: the figures, the
 * wording and the print document are the ones the server tests and the print guards already cover.
 */
export {
  EXPORT_MIN_RANK,
  FILTERS_BY_TYPE,
  REPORT_GROUPS,
  REPORT_MIN_RANK,
  pollKey,
  queryFor,
} from '../../../web/src/screens/report/model';
export { PrintHead, GenerationDisclosure, generatedLine } from '../../../web/src/screens/report/PrintHead';
export { ExecSummary, PrintNotes } from '../../../web/src/screens/report/PrintDoc';
export { AfterNewestProvider, fmtDayShort } from '../../../web/src/screens/report/shared';
export { DailySection } from '../../../web/src/screens/report/Daily';
export { ShiftSection } from '../../../web/src/screens/report/Shift';
export { ProductSection } from '../../../web/src/screens/report/Product';
export { StationSection } from '../../../web/src/screens/report/Station';
export { RejectSection } from '../../../web/src/screens/report/Reject';
export { ConeWeightSection } from '../../../web/src/screens/report/ConeWeight';
export { SackSection } from '../../../web/src/screens/report/Sack';
export { CalibrationSection } from '../../../web/src/screens/report/Calibration';
export { SummarySection } from '../../../web/src/screens/report/Summary';
export { MachineProductSection } from '../../../web/src/screens/report/MachineProduct';
export { ShiftProductionSection } from '../../../web/src/screens/report/ShiftProduction';
export { RejectedConesSection } from '../../../web/src/screens/report/RejectedCones';
export { RejectedSacksSection } from '../../../web/src/screens/report/RejectedSacks';
export { SpsPackingSection } from '../../../web/src/screens/report/SpsPacking';
export { SackWeightRangeSection } from '../../../web/src/screens/report/SackWeightRange';
export { SackWeightSummarySection } from '../../../web/src/screens/report/SackWeightSummary';
export { RejectedHangersSection } from '../../../web/src/screens/report/RejectedHangers';
export { RejectedUnknownLifterSection } from '../../../web/src/screens/report/RejectedUnknownLifter';
