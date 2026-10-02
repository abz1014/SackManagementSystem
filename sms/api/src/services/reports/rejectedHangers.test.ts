/**
 * Task C-R7 (1 Oct 2026): IFL's report 7, the Rejected Cone Hangers Report.
 *
 * Two layers, because a fake pool can run no SQL:
 *  - `assessHangers` is pure and carries every rule that decides what a count
 *    MEANS (inspected = cones + unmatched rejects, the 100-cone floor, the
 *    exact-binomial flag with its Bonferroni threshold, `canFlag`, ordering),
 *    so those are proven by arithmetic on fixtures.
 *  - the builder is proven by the SQL it sends and the parameters bound on it
 *    (one generation on EVERY query, filters, the clock-fault split, the cap)
 *    and by how it assembles the rows the queries return. The SQL's own
 *    semantics were checked against the live dev database in the task report.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

vi.mock('../lineConfig.js', () => ({ getLineIdentity: vi.fn(async () => ({ displayName: 'Line 3', plant: { name: 'TP1' }, unit: { name: 'Unit 2' } })) }));

import {
  assessHangers, getRejectedHangersReport, rejectedHangersCsv, CANNOT_FLAG_REASON, HANGER_MIN_INSPECTED,
  REJECTED_HANGERS_CSV_HEADERS, REJECTED_HANGERS_NOTE, REJECTED_HANGERS_PENDING_IFL,
  type HangerCounts, type RejectedHangersReportData,
} from './rejectedHangers.js';
import { logBinomialUpperTail } from './binomial.js';
import { LIST_CAP } from './common.js';
import type { ShiftRange } from '../../shiftRange.js';

const counts = (hanger: number | null, cones: number, quality = 0, weight = 0, unmatched = 0): HangerCounts => ({
  hanger, cones, unmatched, qualityRejects: quality, weightRejects: weight,
});

/** `n` hangers numbered from 1, each with `cones` cones and `rejects` quality rejects. */
const baseline = (n: number, cones: number, rejects: number, firstHanger = 1): HangerCounts[] =>
  Array.from({ length: n }, (_, i) => counts(firstHanger + i, cones, rejects));

describe('assessHangers: inspected, rate and the total row', () => {
  it('inspected is the cones plus the rejects that match no cone row — a reject that IS a cone row is not added again', () => {
    const r = assessHangers([
      counts(1, 100, 5, 0, 0), // all 5 quality rejects are cone rows already: inspected stays 100
      counts(2, 100, 5, 0, 2), // 2 of them have no cone row: they add 2
      counts(3, 0, 3, 0, 3), // rejects only, no cone rows at all: inspected = 3
    ]);
    const by = (h: number) => r.hangers.find((x) => x.hanger === h)!;
    expect(by(1).inspected).toBe(100);
    expect(by(2).inspected).toBe(102);
    expect(by(3).inspected).toBe(3);
    expect(r.total).toMatchObject({ hanger: null, cones: 200, inspected: 205, qualityRejects: 13, weightRejects: 0, total: 13 });
  });

  it('rate is total / inspected to 2 dp; null when nothing was inspected', () => {
    const r = assessHangers([counts(1, 471, 58, 0, 0), counts(2, 0, 0, 0, 0)]);
    expect(r.hangers[0]).toMatchObject({ hanger: 1, ratePct: 12.31 }); // 58 / 471 = 12.314...
    expect(r.total.ratePct).toBeCloseTo(12.31, 2);
    // A reject counted, but nothing inspected (cannot happen with real data: it would be unmatched): a rate is not made up.
    expect(assessHangers([counts(7, 0, 1, 0, 0)]).hangers[0]!.ratePct).toBeNull();
    expect(assessHangers([]).total).toMatchObject({ cones: 0, inspected: 0, total: 0, ratePct: null });
  });

  it('quality and weight rejects are kept apart and summed into total', () => {
    const r = assessHangers([counts(5, 200, 3, 2, 1)]);
    expect(r.hangers[0]).toMatchObject({ qualityRejects: 3, weightRejects: 2, total: 5, inspected: 201 });
  });

  it('only hangers with a reject are listed; every hanger still counts in the total, the hangers seen and the hangers judged', () => {
    const r = assessHangers([counts(1, 150, 4), counts(2, 150, 0), counts(3, 150, 0)]);
    expect(r.hangers.map((h) => h.hanger)).toEqual([1]);
    expect(r.total).toMatchObject({ cones: 450, inspected: 450, total: 4 });
    expect(r.flagging).toMatchObject({ hangersSeen: 3, hangersJudged: 3 });
  });

  it('a cone carrying both a quality and a weight record counts in both reject columns and once as inspected, without throwing', () => {
    const r = assessHangers([...baseline(40, 200, 2), counts(99, 100, 60, 60)]);
    const h = r.hangers.find((x) => x.hanger === 99)!;
    expect(h).toMatchObject({ inspected: 100, total: 120, flag: 'stands_out' });
  });
});

describe('assessHangers: the "No hanger recorded" bucket', () => {
  it('is listed last whatever its count, is not a hanger (not seen, not judged) and is never flagged', () => {
    const r = assessHangers([...baseline(40, 200, 1), counts(null, 5000, 400), counts(50, 200, 9)]);
    const last = r.hangers[r.hangers.length - 1]!;
    expect(last.hanger).toBeNull();
    expect(last.flag).toBeNull();
    expect(r.hangers[0]!.hanger).toBe(50); // the bucket's 400 rejects do not lift it above a numbered hanger
    expect(r.flagging.hangersSeen).toBe(41);
    expect(r.flagging.hangersJudged).toBe(41);
    // ...but its cones and rejects are in the total and so in the line rate the flag is tested against.
    expect(r.total).toMatchObject({ cones: 40 * 200 + 5000 + 200, total: 40 + 400 + 9 });
  });

  it('is left out of the table when it holds no reject', () => {
    const r = assessHangers([counts(1, 100, 1), counts(null, 40, 0)]);
    expect(r.hangers.map((h) => h.hanger)).toEqual([1]);
    expect(r.total.cones).toBe(140);
  });
});

describe('assessHangers: ordering', () => {
  it('most rejects first, then the higher rate, then the lower hanger number', () => {
    const r = assessHangers([
      counts(30, 1000, 5), // 0.50 %
      counts(10, 500, 5), // 1.00 %: same total, higher rate -> before 30
      counts(20, 500, 5), // same total and rate as 10 -> after it (higher number)
      counts(40, 100, 9), // most rejects -> first
      counts(null, 10, 50),
    ]);
    expect(r.hangers.map((h) => h.hanger)).toEqual([40, 10, 20, 30, null]);
  });
});

describe('assessHangers: the flag', () => {
  it('flags a hanger whose count the line rate cannot explain, in the report 91 shape, and only that one', () => {
    const r = assessHangers([...baseline(39, 200, 4), counts(91, 200, 14)]);
    expect(r.flagging).toMatchObject({ canFlag: true, reason: null, hangersJudged: 40, hangersSeen: 40, minInspected: 100, alpha: 0.05 });
    expect(r.hangers[0]).toMatchObject({ hanger: 91, total: 14, flag: 'stands_out' });
    expect(r.hangers.filter((h) => h.flag === 'stands_out').map((h) => h.hanger)).toEqual([91]);
  });

  it('the threshold is 0.05 / H, not 0.05: a count with an uncorrected p below 5% but above 5%/40 is not flagged', () => {
    // 39 hangers of 200 cones at 4 rejects, plus one of 200 cones at 11: line rate 167 / 8000.
    const x = 11;
    const p0 = (39 * 4 + x) / 8000;
    const tail = Math.exp(logBinomialUpperTail(x, 200, p0));
    expect(tail).toBeLessThan(0.05); // the premise: significant on its own...
    expect(tail).toBeGreaterThan(0.05 / 40); // ...but not after correcting for 40 hangers
    const r = assessHangers([...baseline(39, 200, 4), counts(91, 200, x)]);
    expect(r.hangers.find((h) => h.hanger === 91)!.flag).toBeNull();
  });

  it('judges every flagged hanger against the same period rate: the line rate is reported to 2 dp', () => {
    const r = assessHangers([...baseline(39, 200, 4), counts(91, 200, 14)]);
    expect(r.flagging.lineRatePct).toBe(r.total.ratePct);
    expect(r.flagging.lineRatePct).toBeCloseTo(((39 * 4 + 14) / 8000) * 100, 2);
  });

  it('a hanger under 100 inspected cones is "too few cones to judge", however many rejects it has', () => {
    const r = assessHangers([...baseline(40, 200, 2), counts(77, 99, 30), counts(78, 100, 2)]);
    expect(HANGER_MIN_INSPECTED).toBe(100);
    expect(r.hangers.find((h) => h.hanger === 77)!.flag).toBe('too_few');
    // exactly 100 is enough to be judged, and counts in H
    expect(r.hangers.find((h) => h.hanger === 78)!.flag).toBeNull();
    expect(r.flagging.hangersJudged).toBe(41);
    expect(r.flagging.hangersSeen).toBe(42);
  });

  it('inspected, not cones, decides the 100 floor: 95 cones plus 5 unmatched rejects is judged', () => {
    const r = assessHangers([...baseline(40, 200, 2), counts(90, 95, 5, 0, 5)]);
    expect(r.hangers.find((h) => h.hanger === 90)!.flag).not.toBe('too_few');
    expect(r.flagging.hangersJudged).toBe(41);
  });

  it('a judged hanger with no reject has nothing to flag, and a zero-rate line flags nothing', () => {
    const r = assessHangers(baseline(40, 200, 0));
    expect(r.hangers).toEqual([]);
    expect(r.flagging).toMatchObject({ canFlag: true, lineRatePct: 0 });
  });
});

describe('assessHangers: canFlag', () => {
  it('no flag at all (not even "too few") when fewer than 30 hangers reach 100 inspected cones, and it says why', () => {
    // 29 hangers of 200 cones plus hanger 91 = 30 judged, 10 more of 50 cones seen: 30 >= max(30, 20), so it CAN flag.
    const enough = assessHangers([...baseline(29, 200, 2), counts(91, 200, 30), ...baseline(10, 50, 3, 200)]);
    expect(enough.flagging).toMatchObject({ hangersJudged: 30, hangersSeen: 40, canFlag: true, reason: null });
    // One fewer judged hanger and it cannot: nothing is flagged, not even "too few cones to judge".
    const few = assessHangers([...baseline(28, 200, 2), counts(91, 200, 30), ...baseline(10, 50, 3, 200)]);
    expect(few.flagging.hangersJudged).toBe(29);
    expect(few.flagging.canFlag).toBe(false);
    expect(few.flagging.reason).toBe(CANNOT_FLAG_REASON);
    expect(few.flagging.reason).toContain('choose a longer period');
    expect(few.hangers.length).toBeGreaterThan(0);
    expect(few.hangers.every((h) => h.flag === null)).toBe(true);
  });

  it('needs half the hangers seen as well: 30 judged of 60 seen is enough, of 61 is not', () => {
    const sixty = assessHangers([...baseline(30, 200, 2), ...baseline(30, 20, 1, 100)]);
    expect(sixty.flagging).toMatchObject({ hangersJudged: 30, hangersSeen: 60, canFlag: true });
    const sixtyOne = assessHangers([...baseline(30, 200, 2), ...baseline(31, 20, 1, 100)]);
    expect(sixtyOne.flagging).toMatchObject({ hangersJudged: 30, hangersSeen: 61, canFlag: false, reason: CANNOT_FLAG_REASON });
  });

  it('an empty period cannot flag, and says so in the same words', () => {
    const r = assessHangers([]);
    expect(r.flagging).toMatchObject({ canFlag: false, reason: CANNOT_FLAG_REASON, hangersSeen: 0, hangersJudged: 0, lineRatePct: null });
    expect(r.hangers).toEqual([]);
  });

  it('the reason is present exactly when canFlag is false', () => {
    for (const set of [[], baseline(5, 200, 1), baseline(40, 200, 1)]) {
      const { flagging } = assessHangers(set);
      expect(flagging.reason === null).toBe(flagging.canFlag);
    }
  });
});

/* ------------------------------------------------- the real September and July counts */

/**
 * Per-hanger counts read from the dev database on 1 Oct 2026 with SELECT-only SQL, one generation each (the
 * September copy 2026-08-05 .. 2026-09-07, the July copy 2026-06-22 .. 2026-07-10), as `hanger:cones:unmatched:quality:weight`.
 * They pin the flag RULE to real data: change the rate the test is run at, the 0.05 / H correction or the 100-cone
 * floor and the flagged set below moves. Neither period holds a reject with no hanger number.
 */
const SEPT_2026_REAL = `
  1:346:2:14:1 2:555:0:16:0 3:667:0:27:0 4:358:0:17:0 5:454:3:34:0 6:459:3:21:0 7:565:1:20:0 8:342:0:19:0
  9:704:1:34:0 10:650:1:38:0 11:645:0:26:0 12:395:0:22:0 13:423:2:14:0 14:440:2:11:0 15:573:1:17:0 16:571:2:22:0
  17:364:0:10:0 18:70:0:4:0 19:134:1:4:0 20:891:1:34:0 21:628:1:26:0 22:355:0:16:0 23:316:0:14:0 24:350:0:14:0
  25:101:1:11:0 26:898:0:27:0 27:227:0:18:0 28:239:0:10:0 29:414:5:17:0 30:475:1:17:0 31:493:0:20:0 32:654:2:55:0
  33:449:0:9:0 34:378:1:11:0 35:455:1:14:0 36:702:1:25:0 37:463:2:28:0 38:396:0:14:1 39:452:1:18:0 40:451:0:19:0
  41:624:1:17:0 42:625:0:27:0 43:573:0:35:0 44:528:1:20:0 45:624:0:23:0 46:570:0:19:0 47:275:0:22:0 48:620:1:36:0
  49:403:1:13:0 50:319:0:9:0 51:496:2:36:2 52:665:0:40:0 53:484:0:20:0 54:473:0:28:0 55:508:0:22:0 56:635:0:38:0
  57:510:0:25:0 58:496:0:25:0 59:174:1:10:0 60:497:0:21:0 61:417:0:13:0 62:631:0:33:0 63:368:1:20:0 64:618:0:17:0
  65:512:0:23:1 66:591:0:21:0 67:413:0:18:0 68:611:0:31:0 69:445:1:23:1 70:573:0:22:2 71:457:0:22:0 72:609:0:25:0
  73:454:1:17:0 74:577:0:25:0 75:492:0:20:0 76:588:1:32:0 77:465:0:19:0 78:71:0:8:0 79:261:0:15:0 80:560:1:18:0
  81:469:1:22:0 82:485:0:31:0 83:456:0:26:0 84:613:1:30:0 85:395:1:20:0 86:510:0:22:0 87:483:0:20:1 88:578:0:33:0
  89:448:1:34:0 90:514:0:28:0 91:471:1:58:0 92:576:0:22:0 93:462:0:20:0 94:365:2:24:0 95:549:1:25:1 96:567:1:29:0
  97:456:1:15:0 98:457:0:19:1 99:522:0:25:0 100:464:1:17:0 101:517:0:27:0 102:464:0:24:0 103:442:0:12:0 104:537:0:18:0
  105:503:1:44:0 106:99:0:7:0 107:616:0:25:0 108:499:0:27:0 109:109:0:2:0 110:547:0:35:0 111:570:0:27:0 112:530:0:28:0
  113:285:0:17:1 114:521:1:32:2 115:514:0:25:0 116:466:0:18:0 117:80:0:6:0 118:587:1:24:0 119:560:0:18:0 120:485:0:24:0
  121:278:1:15:0 122:385:1:25:0 123:453:1:18:1 124:309:0:13:0 125:503:0:19:0 126:489:0:19:1 127:516:0:23:1 128:368:0:16:0
  129:497:0:24:0 130:476:0:13:0 131:509:0:33:0 132:376:0:11:0 133:455:0:24:0 134:368:0:15:0 135:554:0:27:0 136:413:0:20:0
  137:459:0:26:0 138:446:0:16:0 139:390:0:20:0 140:302:1:10:0 141:283:1:9:0 142:474:2:21:0 143:562:0:24:0 144:443:0:19:0
  145:292:2:16:0 146:503:0:14:0 147:465:1:14:0 148:482:0:28:0 149:335:1:11:0 150:393:0:17:1 151:382:0:11:0 152:536:1:36:0
  153:248:0:12:0 154:391:1:14:0 155:369:2:20:0 156:322:2:19:0 157:504:0:23:0 158:491:0:29:0 159:444:0:20:0 160:351:2:16:0
  161:478:0:25:0 162:492:0:23:1 163:446:0:17:0 164:376:0:18:0 165:307:0:14:0 166:540:2:26:1 167:324:1:14:0 168:500:0:25:0
  169:396:0:18:0 170:491:0:21:0 171:430:0:20:0 172:487:0:26:0 173:388:0:20:0 174:480:0:15:0 175:434:0:22:0 176:407:0:11:0
  177:450:0:24:1 178:378:0:18:1 179:502:0:18:1 180:397:0:19:0 181:444:0:26:0 182:392:0:23:0 183:472:0:32:1 184:423:1:16:0
  185:285:0:17:0 186:307:1:7:1 187:412:2:19:0 188:544:0:25:0 189:394:0:23:1 190:370:0:17:0 191:431:0:17:0 192:522:0:27:0
  193:408:0:24:0 194:376:0:17:0 195:425:0:28:0 196:508:1:21:0 197:406:0:23:0 198:380:0:11:0 199:442:0:41:0 200:507:0:26:0
  201:167:1:8:1 202:338:3:25:0 203:337:1:15:0 204:559:0:23:0 205:363:0:41:0 206:413:1:20:0 207:340:0:15:0 208:580:0:21:0
  209:396:0:21:0 210:406:1:28:0 211:366:0:17:1 212:562:0:20:0 213:410:0:15:0 214:415:0:22:1 215:366:1:24:0 216:554:0:35:0
  217:415:1:21:0 218:424:0:17:0 219:370:0:13:0 220:545:0:18:0 221:416:0:10:0 222:442:0:24:0 223:369:0:22:0 224:529:1:32:0
  225:413:0:11:0 226:439:0:13:0 227:382:1:8:0 228:330:0:8:0 229:519:0:15:0 230:454:0:23:0 231:432:0:25:0 232:372:0:20:0
  233:521:0:16:0 234:447:0:19:0 235:446:0:32:0 236:376:0:11:1 237:510:0:18:0 238:406:0:21:0 239:459:0:14:0 240:385:0:15:1
  241:526:0:23:0 242:430:0:16:0 243:452:0:20:0 244:268:3:21:0 245:568:0:30:1 246:442:0:21:0 247:462:0:21:0 248:338:0:13:0
  249:536:0:25:0 250:336:0:9:0 251:521:0:23:0 252:371:0:17:0 253:543:0:17:0 254:370:0:13:0 255:502:0:14:0 256:376:0:17:0
  257:536:0:16:0 258:385:0:17:0 259:512:0:18:1 260:398:0:14:0 261:387:1:21:0 262:62:0:7:0 263:658:0:31:0 264:435:0:29:1
  265:416:0:19:0 266:257:0:14:0 267:631:0:19:0 268:57:2:8:0 269:636:0:29:1 270:97:0:6:0 271:666:0:21:0 272:341:0:21:0
  273:582:0:29:3 274:243:0:14:0 275:633:0:19:0 276:276:0:10:0 277:563:0:24:1 278:285:0:9:0 279:606:0:20:0 280:334:0:10:1
  281:529:0:18:0 282:330:0:17:0 283:582:0:25:0 284:358:0:14:0 285:504:0:8:1 286:354:0:16:0 287:367:4:16:0 288:324:3:10:0
  289:560:0:29:0 290:431:0:18:0 291:434:0:25:0 292:366:0:14:0 293:131:1:8:0 294:621:0:19:0 295:436:0:23:0 296:474:0:16:0
  297:82:0:5:0 298:605:1:17:0
`;

const JULY_2026_REAL = `
  1:481:0:8:1 2:478:0:14:1 3:561:0:18:2 4:521:0:19:1 5:665:0:13:0 6:618:0:11:1 7:591:0:11:0 8:572:0:11:0
  9:648:0:15:1 10:626:0:15:0 11:571:2:17:1 12:552:0:5:0 13:630:0:15:2 14:603:0:14:0 15:555:0:21:1 16:543:0:17:0
  17:604:0:11:1 18:586:0:20:0 19:562:0:14:0 20:534:0:11:1 21:582:0:6:3 22:575:0:8:1 23:571:0:12:2 24:530:1:17:0
  25:583:0:9:0 26:566:0:8:0 27:579:0:12:1 28:556:0:13:0 29:569:1:8:0 30:560:0:13:1 31:566:0:11:2 32:534:0:9:1
  33:546:0:8:1 34:561:0:14:0 35:561:0:11:1 36:529:0:13:0 37:564:0:9:1 38:560:1:12:2 39:553:0:10:1 40:535:0:10:1
  41:538:0:13:1 42:552:0:11:0 43:526:0:8:1 44:518:0:14:1 45:484:0:12:0 46:518:0:8:1 47:497:0:13:2 48:508:0:11:1
  49:425:0:3:1 50:465:0:19:4 51:486:0:9:0 52:480:0:12:0 53:438:0:16:0 54:464:1:10:0 55:461:0:9:0 56:474:0:8:0
  57:461:0:11:0 58:474:0:6:1 59:471:0:3:0 60:465:0:10:1 61:469:0:6:0 62:497:0:11:1 63:462:0:8:0 64:456:0:16:0
  65:482:0:15:0 66:476:0:9:0 67:476:0:8:0 68:391:0:6:0 69:500:0:8:0 70:486:0:7:45 71:487:0:12:0 72:178:0:7:0
  73:563:0:16:1 74:508:0:12:0 75:502:0:9:1 76:434:0:8:1 77:525:0:5:0 78:223:0:7:0 79:528:0:10:0 80:444:0:9:0
  81:513:0:12:2 82:440:0:14:0 83:517:0:9:1 84:482:0:11:1 85:503:0:16:0 86:472:0:9:1 87:493:0:9:0 88:490:0:6:3
  89:500:0:13:1 90:485:0:9:0 91:487:0:10:0 92:485:0:11:2 93:486:0:9:0 94:479:1:12:0 95:471:0:13:2 96:481:0:11:3
  97:444:0:13:0 98:485:0:6:0 99:470:0:5:0 100:477:0:9:0 101:446:0:7:0 102:492:0:11:0 103:448:0:9:0 104:472:0:6:0
  105:434:0:7:0 106:490:0:8:0 107:459:0:11:0 108:476:0:4:0 109:474:0:9:2 110:482:0:13:0 111:456:0:8:0 112:464:0:11:1
  113:481:1:10:2 114:481:0:8:1 115:471:0:6:2 116:461:0:10:1 117:476:0:10:2 118:473:0:8:1 119:465:0:11:1 120:464:0:7:1
  121:498:0:8:2 122:453:0:7:0 123:476:0:13:1 124:469:0:11:1 125:477:0:10:3 126:455:0:4:0 127:469:0:5:3 128:474:0:16:0
  129:477:0:15:2 130:445:0:7:0 131:475:0:11:0 132:472:0:11:0 133:471:0:11:0 134:448:1:15:0 135:481:0:7:0 136:468:0:13:0
  137:463:0:13:0 138:464:0:8:1 139:486:0:9:1 140:469:0:6:0 141:471:0:8:0 142:469:0:7:0 143:490:0:9:0 144:466:0:6:0
  145:465:0:5:0 146:463:0:7:1 147:488:1:12:0 148:485:0:4:0 149:468:0:4:1 150:455:0:13:1 151:477:0:9:0 152:473:0:5:4
  153:459:0:8:0 154:473:0:12:1 155:496:0:6:0 156:479:0:5:0 157:461:0:11:0 158:476:0:8:0 159:496:0:18:2 160:494:0:12:1
  161:459:0:11:2 162:478:0:9:1 163:494:0:9:2 164:481:0:9:0 165:470:0:11:0 166:474:0:6:1 167:484:0:5:0 168:471:0:8:0
  169:477:0:13:0 170:465:0:11:2 171:477:0:7:0 172:460:0:7:0 173:487:0:10:1 174:457:0:9:1 175:481:0:11:2 176:472:0:9:0
  177:491:0:14:0 178:464:0:15:0 179:411:0:14:0 180:501:0:5:0 181:474:0:8:0 182:456:0:11:0 183:451:1:13:0 184:495:0:7:0
  185:463:0:11:0 186:470:0:14:1 187:443:0:14:0 188:474:0:7:0 189:469:0:10:0 190:465:0:9:2 191:437:0:11:0 192:485:0:7:1
  193:459:0:13:0 194:469:0:6:1 195:461:0:7:0 196:467:0:9:0 197:452:0:9:0 198:475:0:12:0 199:451:0:5:2 200:459:0:4:0
  201:459:0:7:0 202:468:0:8:0 203:437:0:12:1 204:466:0:10:0 205:446:0:15:1 206:470:0:23:1 207:439:0:14:11 208:467:0:13:0
  209:459:0:15:0 210:465:0:12:0 211:448:0:9:0 212:464:0:7:1 213:462:0:7:0 214:473:0:12:1 215:450:0:6:2 216:473:0:7:1
  217:444:0:6:1 218:457:0:9:1 219:449:1:6:0 220:469:0:8:1 221:436:0:12:0 222:467:0:4:0 223:457:0:10:0 224:453:0:9:2
  225:432:0:12:0 226:387:0:11:1 227:469:0:10:2 228:473:0:12:1 229:446:0:10:0 230:439:0:10:0 231:458:0:7:0 232:456:0:10:0
  233:454:0:12:0 234:443:0:7:0 235:450:0:6:1 236:457:0:10:2 237:448:0:5:2 238:454:0:10:0 239:446:0:6:0 240:439:0:4:4
  241:442:0:8:0 242:454:0:13:3 243:433:0:7:0 244:447:0:12:2 245:425:0:4:0 246:453:0:14:1 247:436:0:6:0 248:449:0:9:2
  249:438:0:7:0 250:452:0:5:2 251:431:0:10:0 252:446:0:9:1 253:433:0:6:1 254:436:0:9:0 255:426:0:9:0 256:457:0:3:2
  257:438:0:5:0 258:438:0:8:1 259:428:0:8:0 260:452:0:3:1 261:440:0:9:1 262:454:0:6:1 263:422:0:13:0 264:426:0:10:1
  265:449:0:10:1 266:460:0:9:1 267:438:0:6:0 268:442:0:8:2 269:449:0:5:0 270:463:0:6:1 271:458:0:7:0 272:203:0:2:0
  273:495:0:9:1 274:495:0:13:0 275:493:0:15:1 276:363:0:7:0 277:471:0:12:1 278:482:0:6:0 279:479:0:14:0 280:393:0:8:0
  281:468:0:8:1 282:475:0:11:1 283:493:0:12:1 284:400:0:10:2 285:453:0:15:0 286:468:0:7:2 287:483:0:9:0 288:420:0:4:1
  289:468:0:13:0 290:474:0:7:1 291:480:0:6:1 292:449:0:11:0 293:390:1:14:0 294:486:0:9:1 295:494:1:10:1 296:484:0:5:1
  297:429:0:8:0 298:441:0:4:0 299:414:0:5:0
`;

const parseCounts = (text: string): HangerCounts[] =>
  text.trim().split(/\s+/).map((t) => {
    const [h, c, u, q, w] = t.split(':').map(Number) as [number, number, number, number, number];
    return counts(h, c, q, w, u);
  });

describe('assessHangers: the real September and July periods', () => {
  const sept = assessHangers(parseCounts(SEPT_2026_REAL));
  const july = assessHangers(parseCounts(JULY_2026_REAL));
  const flagged = (r: typeof sept) => r.hangers.filter((h) => h.flag === 'stands_out').map((h) => h.hanger);

  it('September: 5 hangers stand out — 91, 32, 105, 205, 199 — the five the 29 Sep 2026 audit named, from 6,089 rejects over 132,665 inspected cones', () => {
    expect(sept.total).toMatchObject({ cones: 132550, inspected: 132665, qualityRejects: 6048, weightRejects: 41, total: 6089, ratePct: 4.59 });
    expect(sept.flagging).toMatchObject({ canFlag: true, hangersSeen: 298, hangersJudged: 290, lineRatePct: 4.59 });
    expect(flagged(sept)).toEqual([91, 32, 105, 205, 199]); // by total rejects, descending
    expect(new Set(flagged(sept))).toEqual(new Set([91, 205, 199, 32, 105]));
    // hanger 91: 58 rejects on 471 cones (472 inspected, one reject has no cone row)
    expect(sept.hangers[0]).toMatchObject({ hanger: 91, cones: 471, inspected: 472, qualityRejects: 58, weightRejects: 0, total: 58, ratePct: 12.29, flag: 'stands_out' });
  });

  it('September: no hanger below the 0.05 / 290 line is flagged, and hangers over it at the plain 5% level are not', () => {
    // 24 hangers pass an uncorrected 5% test on this period (computed outside this code, exact arithmetic); only 5 survive the correction.
    const rate = sept.total.total / sept.total.inspected;
    const unc = sept.hangers.filter((h) => h.hanger != null && h.inspected >= 100 && h.total > 0
      && Math.exp(logBinomialUpperTail(Math.min(h.total, h.inspected), h.inspected, rate)) < 0.05);
    expect(unc).toHaveLength(24);
    expect(flagged(sept)).toHaveLength(5);
  });

  it('July: hanger 70 stands out (45 weight rejects and 7 quality on 486 cones), alongside 207 and 206', () => {
    expect(july.total).toMatchObject({ cones: 142508, inspected: 142522, qualityRejects: 2899, weightRejects: 245, total: 3144, ratePct: 2.21 });
    expect(july.flagging).toMatchObject({ canFlag: true, hangersSeen: 299, hangersJudged: 299 });
    expect(july.hangers[0]).toMatchObject({ hanger: 70, cones: 486, inspected: 486, qualityRejects: 7, weightRejects: 45, total: 52, flag: 'stands_out' });
    expect(new Set(flagged(july))).toEqual(new Set([70, 207, 206]));
  });
});

/* ------------------------------------------------------------- the builder */

interface Call { sql: string; params: Map<string, unknown> }

interface Answers {
  present?: Record<string, unknown>[];
  epochs?: Record<string, unknown>[];
  cones?: Record<string, unknown>[];
  rejects?: Record<string, unknown>[];
  unmatched?: Record<string, unknown>[];
  list?: Record<string, unknown>[];
}

function fakePool(a: Answers = {}): { pool: ConnectionPool; calls: Call[]; of: (what: 'cones' | 'rejects' | 'unmatched' | 'list' | 'scope') => Call } {
  const calls: Call[] = [];
  const kind = (sql: string): 'scope' | 'epochs' | 'unmatched' | 'list' | 'cones' | 'rejects' => {
    if (sql.includes('GROUP BY source_epoch')) return 'scope';
    if (sql.includes('FROM sms.source_epoch')) return 'epochs';
    if (sql.includes('NOT EXISTS')) return 'unmatched';
    if (sql.includes('TOP (@cap)')) return 'list';
    if (sql.includes('FROM sms.cone_event')) return 'cones';
    return 'rejects';
  };
  const pool = {
    request: () => {
      const params = new Map<string, unknown>();
      const req = {
        input: (n: string, _t: unknown, v: unknown) => { params.set(n, v); return req; },
        query: async (sql: string) => {
          const k = kind(sql);
          calls.push({ sql, params });
          const rows = { scope: a.present, epochs: a.epochs, unmatched: a.unmatched, list: a.list, cones: a.cones, rejects: a.rejects }[k] ?? [];
          return { recordset: rows, rowsAffected: [rows.length] };
        },
      };
      return req;
    },
  } as unknown as ConnectionPool;
  const of = (what: 'cones' | 'rejects' | 'unmatched' | 'list' | 'scope') => {
    const c = calls.find((x) => kind(x.sql) === what);
    if (!c) throw new Error(`no ${what} query was sent`);
    return c;
  };
  return { pool, calls, of };
}

const PERIOD = { period: 'custom' as const, from: '2026-08-05', to: '2026-09-07' };
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('getRejectedHangersReport: the SQL it sends', () => {
  it('sends the four queries and groups every one by the same hanger key, no-hanger as its own bucket', async () => {
    const { pool, of } = fakePool();
    await getRejectedHangersReport(pool, 1, PERIOD, {});
    for (const w of ['cones', 'rejects', 'unmatched'] as const) {
      expect(of(w).sql).toMatch(/hanger_num IS NULL OR (re\.)?hanger_num = 0 THEN 'none'/);
    }
    expect(of('cones').sql).toContain('FROM sms.cone_event');
    expect(of('rejects').sql).toContain('GROUP BY');
    expect(of('rejects').sql).toContain('re.reject_type');
    expect(of('list').sql).toMatch(/ORDER BY re\.production_ts_utc_ms, re\.reject_event_id/);
  });

  it('matches a reject to its cone row by the shared merge-key predicate (getUnmatchedRejects), so inspected never double-counts', async () => {
    const { pool, of } = fakePool();
    await getRejectedHangersReport(pool, 1, PERIOD, {});
    const sql = of('unmatched').sql;
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('ce.production_ts_utc_ms = re.production_ts_utc_ms');
    expect(sql).toContain('ISNULL(ce.hanger_num, -1) = ISNULL(re.hanger_num, -1)');
  });

  it('drops zeroed-clock records from every table: the cone and list queries require a real production time, the reject query splits them off', async () => {
    const { pool, of } = fakePool();
    await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(of('cones').sql).toContain('production_ts_utc_ms > 0');
    expect(of('list').sql).toContain('re.production_ts_utc_ms > 0');
    expect(of('rejects').sql).toContain("WHEN re.production_ts_utc_ms <= 0 THEN 'fault'");
    expect(of('unmatched').sql).toContain("WHEN re.production_ts_utc_ms <= 0 THEN 'fault'");
  });

  it('the list is capped in SQL at LIST_CAP, oldest first, with the reject_code label joined', async () => {
    const { pool, of } = fakePool();
    await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(of('list').params.get('cap')).toBe(LIST_CAP);
    expect(of('list').sql).toContain('LEFT JOIN sms.reject_code rc');
  });

  it('confines EVERY query — cones, rejects, the unmatched check on both its sides, the list — to the one generation resolved', async () => {
    const present = [
      { tbl: 'cone_event', epoch_id: 9, n: 1000 },
      { tbl: 'reject_event', epoch_id: 11, n: 40 },
      { tbl: 'reject_event', epoch_id: 12, n: 3 },
      // another generation in the same window (the plant simulator's): must not be read
      { tbl: 'cone_event', epoch_id: 13, n: 700 },
      { tbl: 'reject_event', epoch_id: 15, n: 30 },
    ];
    const epochs = [
      { epoch_id: 9, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: null },
      { epoch_id: 11, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: null },
      { epoch_id: 12, source_db: 'DATA_TP1U2_SEP07', generation_ordinal: 3, provenance: 'ifl_copy', label: null },
      { epoch_id: 13, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'simulator', label: null },
      { epoch_id: 15, source_db: 'DATA_TP1U2_SIM', generation_ordinal: 4, provenance: 'simulator', label: null },
    ];
    const { pool, of } = fakePool({ present, epochs });
    const r = await getRejectedHangersReport(pool, 1, PERIOD, {});
    const epochValues = (c: Call) => [...c.params].filter(([n]) => /^(ge|um)[cr]\d$/.test(n)).map(([, v]) => Number(v)).sort((a, b) => a - b);
    expect(epochValues(of('cones'))).toEqual([9]);
    expect(epochValues(of('rejects'))).toEqual([11, 12]);
    expect(epochValues(of('list'))).toEqual([11, 12]);
    // the unmatched check binds the reject side AND the cone side
    expect(epochValues(of('unmatched'))).toEqual([9, 11, 12]);
    expect(of('cones').sql).toContain('source_epoch = @gec0');
    expect(of('unmatched').sql).toMatch(/ce\.source_epoch = @umc0/);
    // and the report says which generation it read and what it left out
    expect(r.generationNote.generation?.key).toBe('DATA_TP1U2_SEP07#3');
    expect(r.generationNote.spansGenerations).toBe(true);
    expect(r.generationNote.excludedSimulator).toBe(730);
  });

  it('binds the shift, winder, product and shift-range filters on the cone, reject and list queries', async () => {
    const range: ShiftRange = { from: '2026-08-05', fromShift: 'morning', to: '2026-08-06', toShift: 'evening' };
    const { pool, of } = fakePool();
    await getRejectedHangersReport(pool, 1, PERIOD, { shift: 'night', station: 7, product: 1021 }, range);
    for (const w of ['cones', 'rejects', 'list', 'unmatched'] as const) {
      const c = of(w);
      expect(c.params.get('shift'), w).toBe('night');
      expect(c.params.get('station'), w).toBe(7);
      expect(c.params.get('product'), w).toBe(1021);
      expect(c.params.get('srFromOrd'), w).toBe(1);
      expect(c.params.get('srToOrd'), w).toBe(2);
      expect(c.sql, w).toContain('source_station = @station');
      expect(c.sql, w).toContain('material_id = @product');
    }
  });
});

describe('getRejectedHangersReport: assembling the rows', () => {
  const cones = [{ hk: '91', n: 471 }, { hk: '12', n: 300 }, { hk: '7', n: 120 }, { hk: 'none', n: 3 }];
  const rejects = [
    { hk: '91', rt: 'quality', n: 58 },
    { hk: '12', rt: 'quality', n: 4 },
    { hk: '12', rt: 'weight', n: 1 },
    { hk: 'none', rt: 'quality', n: 2 },
    { hk: 'fault', rt: 'quality', n: 1 },
    { hk: 'fault', rt: 'weight', n: 1 },
  ];
  const unmatched = [{ grp: '91', n: 2 }, { grp: 'none', n: 2 }, { grp: 'fault', n: 2 }];

  it('inspected is cones plus unmatched rejects; the zeroed-clock records are dropped from every figure and counted', async () => {
    const { pool } = fakePool({ cones, rejects, unmatched });
    const r = await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(r.hangers.map((h) => [h.hanger, h.cones, h.inspected, h.qualityRejects, h.weightRejects, h.total])).toEqual([
      [91, 471, 473, 58, 0, 58],
      [12, 300, 300, 4, 1, 5],
      [null, 3, 5, 2, 0, 2],
    ]);
    expect(r.total).toMatchObject({ hanger: null, cones: 894, inspected: 898, qualityRejects: 64, weightRejects: 1, total: 65 });
    expect(r.excludedClockFault).toBe(2);
    expect(r.listTotal).toBe(65); // the clock-fault records are in neither the table nor the list's total
    expect(r.flagging).toMatchObject({ hangersSeen: 3, hangersJudged: 3, canFlag: false, reason: CANNOT_FLAG_REASON });
  });

  it('a reject that IS a cone row does not raise the cones inspected — the double count the report must not commit', async () => {
    // 100 cones on hanger 5, 4 of them rejected; the reject records match cone rows, so nothing is unmatched and inspected stays 100.
    const { pool } = fakePool({ cones: [{ hk: '5', n: 100 }], rejects: [{ hk: '5', rt: 'quality', n: 3 }, { hk: '5', rt: 'weight', n: 1 }], unmatched: [] });
    const r = await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(r.hangers[0]).toMatchObject({ hanger: 5, cones: 100, inspected: 100, total: 4, ratePct: 4 });
    expect(r.total).toMatchObject({ cones: 100, inspected: 100, total: 4, ratePct: 4 });
  });

  it('a hanger with no cone row at all still gets a row from its rejects', async () => {
    const { pool } = fakePool({ rejects: [{ hk: '55', rt: 'quality', n: 2 }], unmatched: [{ grp: '55', n: 2 }] });
    const r = await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(r.hangers).toHaveLength(1);
    expect(r.hangers[0]).toMatchObject({ hanger: 55, cones: 0, inspected: 2, total: 2 });
  });

  it('flags hanger 91 when enough hangers are judged, over the same arithmetic as assessHangers', async () => {
    const conesMany = [...Array.from({ length: 39 }, (_, i) => ({ hk: String(i + 1), n: 200 })), { hk: '91', n: 200 }];
    const rejectsMany = [...Array.from({ length: 39 }, (_, i) => ({ hk: String(i + 1), rt: 'quality', n: 4 })), { hk: '91', rt: 'quality', n: 14 }];
    const { pool } = fakePool({ cones: conesMany, rejects: rejectsMany });
    const r = await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(r.flagging.canFlag).toBe(true);
    expect(r.hangers[0]).toMatchObject({ hanger: 91, flag: 'stands_out' });
    expect(r.hangers.filter((h) => h.flag === 'stands_out')).toHaveLength(1);
  });

  it('maps each reject: plant-clock instant as read, the reason as a label or the raw codes, none for a weight reject, hanger 0 as no hanger', async () => {
    const list = [
      { d: d('2026-09-01'), sc: 'morning', ts: new Date('2026-09-01T07:00:09Z'), h: 91, st: 4, rt: 'quality', tube: 3, mat: 0, w: null, label: 'Soiled tube' },
      { d: d('2026-09-01'), sc: 'morning', ts: new Date('2026-09-01T07:05:00Z'), h: 91, st: 4, rt: 'quality', tube: 2, mat: null, w: null, label: null },
      { d: d('2026-09-02'), sc: 'night', ts: new Date('2026-09-02T02:00:00Z'), h: 0, st: null, rt: 'weight', tube: null, mat: null, w: 2032.5, label: 'Weight out of range' },
    ];
    const { pool } = fakePool({ list, rejects: [{ hk: '91', rt: 'quality', n: 2 }, { hk: 'none', rt: 'weight', n: 1 }] });
    const r = await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(r.list).toEqual([
      { date: '2026-09-01', shift: 'morning', producedAtUtc: '2026-09-01T07:00:09.000Z', hanger: 91, winder: 4, rejectType: 'quality', reason: 'Soiled tube', weightG: null },
      { date: '2026-09-01', shift: 'morning', producedAtUtc: '2026-09-01T07:05:00.000Z', hanger: 91, winder: 4, rejectType: 'quality', reason: 'Tube 2 · Mat —', weightG: null },
      { date: '2026-09-02', shift: 'night', producedAtUtc: '2026-09-02T02:00:00.000Z', hanger: null, winder: null, rejectType: 'weight', reason: null, weightG: 2032.5 },
    ]);
  });

  it('listTotal is what the period holds, listCap the cap; a list cut at the cap says so by listTotal > listCap', async () => {
    const { pool } = fakePool({ rejects: [{ hk: '3', rt: 'quality', n: 6000 }], list: [] });
    const r = await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(r.listTotal).toBe(6000);
    expect(r.listCap).toBe(LIST_CAP);
    expect(r.listTotal).toBeGreaterThan(r.listCap);
  });

  it('an empty period is a valid report: no rows, nothing flagged, the reason given', async () => {
    const { pool } = fakePool();
    const r = await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(r).toMatchObject({
      hangers: [], list: [], listTotal: 0, listCap: LIST_CAP, excludedClockFault: 0, lineId: 1,
      total: { hanger: null, cones: 0, inspected: 0, total: 0, ratePct: null, flag: null },
      flagging: { canFlag: false, reason: CANNOT_FLAG_REASON, lineRatePct: null, hangersSeen: 0, hangersJudged: 0, minInspected: 100, alpha: 0.05 },
    });
    expect(r.period).toEqual(PERIOD);
    expect(r.generationNote.spansGenerations).toBe(false);
  });

  it('the assumed-until-IFL lines are carried, and a winder or product filter adds the sentence that says what it changes', async () => {
    const { pool } = fakePool();
    const plain = await getRejectedHangersReport(pool, 1, PERIOD, {});
    expect(plain.pendingIfl).toEqual([...REJECTED_HANGERS_PENDING_IFL]);
    expect(plain.note).toBe(REJECTED_HANGERS_NOTE);
    const narrowed = await getRejectedHangersReport(pool, 1, PERIOD, { station: 6, product: 1021 });
    expect(narrowed.note).toContain(REJECTED_HANGERS_NOTE);
    expect(narrowed.note).toContain('winder 6');
    expect(narrowed.note).toContain('no product on record');
  });

  it('never calls a hanger bad, faulty or defective, in the note, the assumptions or the reason it gives', async () => {
    const { pool } = fakePool({ cones, rejects, unmatched });
    const r = await getRejectedHangersReport(pool, 1, PERIOD, { station: 3 });
    const words = [r.note, ...r.pendingIfl, r.flagging.reason ?? '', REJECTED_HANGERS_NOTE].join(' ');
    expect(words).not.toMatch(/\b(bad|faulty|defective|broken|worn)\b/i);
    expect(r.note).toContain('stands out in this period');
  });
});

describe('rejectedHangersCsv', () => {
  it('keeps the frozen headers and writes the table, the total and one row per reject, every row the header width', async () => {
    const { pool } = fakePool({
      cones: [{ hk: '91', n: 471 }],
      rejects: [{ hk: '91', rt: 'quality', n: 1 }],
      list: [{ d: d('2026-09-01'), sc: 'morning', ts: new Date('2026-09-01T07:00:09Z'), h: 91, st: 4, rt: 'quality', tube: 3, mat: 0, w: null, label: null }],
    });
    const r: RejectedHangersReportData = await getRejectedHangersReport(pool, 1, PERIOD, {});
    const t = rejectedHangersCsv(r);
    expect(t.headers).toEqual([...REJECTED_HANGERS_CSV_HEADERS]);
    for (const row of t.rows) expect(row).toHaveLength(t.headers.length);
    expect(t.rows.map((x) => x[0])).toEqual(['hanger', 'total', 'reject']);
    const reject = t.rows[2]!;
    expect(reject[t.headers.indexOf('produced_at_plant_time')]).toBe('2026-09-01 07:00:09');
    expect(reject[t.headers.indexOf('reason')]).toBe('Tube 3 · Mat 0');
  });
});
