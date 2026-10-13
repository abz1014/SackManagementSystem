# Why "Failed weight check (scale)" is 49 on Today and 53 in the summary

Period 5 Aug - 7 Sep 2026 (PL). Read-only SELECTs on `sms_audit`. Written 13 Oct 2026.

## Answer

Same generation, same period, same rows. The difference is the **definition**, not the scope.

- **53** = `COUNT(*) WHERE in_range = 0` (summary KPI `cones_rejected_by_scale`, via `register.ts countEvents`, `inRange:false`; KPI-DEFINITIONS row 3).
- **49** = `states.rejected` from `/api/production`. That is a **mutually exclusive state classification** (`coneState.ts bindStateCase`). Its first WHEN is `weight NULL or outside the plausibility window (1500-2100 g) -> 'unknown'`; only then `in_range = 0 -> 'rejected'`. So a cone the scale flagged out of range, whose weight is also implausible, is counted as `unknown`, not `rejected`.
- The 4 cones are exactly those: scale flag = 0 AND weight outside 1500-2100 g.

Ruled out: generation scoping (both paths scope to SEP07, epoch 9; the 397 simulator rows in epoch 13 are in neither number), 1969 sentinel rows (none in this window), 06:00 day boundary (both use `shift_date`), excluded stations (none; stations 2 and 11). The 41 weight-reject records are a different table (`reject_event`) and a different fact.

## SQL

```sql
SELECT e.source_epoch, ep.source_db, ep.generation_ordinal, ep.provenance, COUNT(*) n_all,
 SUM(CASE WHEN in_range=0 THEN 1 ELSE 0 END) inrange0,
 SUM(CASE WHEN in_range=0 AND weight_g BETWEEN 1500 AND 2100 THEN 1 ELSE 0 END) inrange0_plaus,
 SUM(CASE WHEN in_range=0 AND NOT (weight_g BETWEEN 1500 AND 2100) THEN 1 ELSE 0 END) inrange0_implaus
FROM sms.cone_event e LEFT JOIN sms.source_epoch ep ON ep.epoch_id=e.source_epoch
WHERE e.shift_date BETWEEN '2026-08-05' AND '2026-09-07'
GROUP BY e.source_epoch, ep.source_db, ep.generation_ordinal, ep.provenance;
```

| epoch | source_db | gen | cones | in_range=0 | of which plausible | implausible |
|---|---|---|---|---|---|---|
| 13 | DATA_TP1U2_SIM | 4 | 135,248 | 397 | 397 | 0 |
| 9 | DATA_TP1U2_SEP07 | 3 | 132,550 | **53** | **49** | **4** |

Plausibility rule in force (`sms.plausibility_rule` id 3): 1500-2100 g.

## The 4 cones (all epoch 9, DATA_TP1U2_SEP07, generation 3, in_range = 0)

| cone_event_id | production_ts (plant) | shift | station | hanger | weight_g | material |
|---|---|---|---|---|---|---|
| 847149 | 2026-08-07 07:46:01.590 | morning | 2 | 76 | 1419 | 20 |
| 858978 | 2026-08-09 06:52:07.943 | morning | 2 | 269 | 939 | 20 |
| 910599 | 2026-08-19 19:01:44.707 | evening | 11 | 167 | 2360 | 21 |
| 910605 | 2026-08-19 19:02:47.063 | evening | 11 | 179 | 2953 | 21 |

## Which is right

CLAUDE.md "ONE STATUS VOCABULARY": the scale's own in-range bit is the single flag, named as the scale's ("Rejected by the scale"). The label "Failed weight check (scale)" promises that bit, so **53 is the correct figure for that label**. The 49 silently drops four cones the scale did reject, because a second, separate fact (implausible weight) took precedence in a classification built for a different purpose (the five-way within/low/high/rejected/unknown split, where exclusivity is needed so the parts sum to the total).

Verdict: a defect in the **Today tile's source mapping** (`web/src/screens/Today/model.ts failedWeightCheck`, reading `data.states.rejected`), not in the summary and not in `production.ts` (its `states` are correct for what they are). Not two legitimate scopes.

## Recommendation

1. Today tile should show the scale-flag count (53), from a count that does not pass through the state CASE: e.g. add a non-exclusive `scaleRejected` (`SUM(in_range=0)`) to `/api/production` rows next to `conesInRangePct` (that column already derives from the same bit: 100 - conesInRangePct is the same population), or reuse `countEvents inRange:false`. Denominator stays cones.
2. If the five-state breakdown is also shown, keep `rejected` = 49 there but footnote it: "4 more flagged by the scale have an implausible weight and are counted under unknown."
3. Add a test pinning that the Today figure equals the summary `cones_rejected_by_scale` for a dataset that contains an implausible, scale-rejected cone (today's tests apparently do not).
4. Not verified: the app's running code was not executed; figures come from SQL on `sms_audit` and code reading.
