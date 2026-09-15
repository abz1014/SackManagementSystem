/**
 * One production day's stock movements, in a sheet over the Sacks screen
 * (roadmap Phase 7 item 3, 15 Sep 2026): `?sheet=stock:<day>`.
 *
 * WHAT IT SAYS. The sacks the scale weighed that day — they are the derived
 * receipts, and the sentence says so — then every movement a person
 * recorded: when it happened (plant time), what, how many, which product,
 * who recorded it, when they recorded it (this system's own clock, shown in
 * the viewer's zone — the two clocks named, as on the reading sheet), and
 * why. Nothing is editable: a correction is a new row from the screen's form.
 *
 * The day is the PRODUCTION day (06:00-06:00 under the line's shift rule),
 * the same axis as the ledger and the sack register; the eyebrow says so.
 */
import { useEffect, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Failed, Loading } from '../ui/bits';
import { W } from '../lib/words';
import { fmtAppInstant, fmtClock, fmtDayLong, fmtInt, fmtKg } from '../lib/fmt';
import { getSackMovements, type SackMovementsData } from '../api';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function StockSheet({ day, onClose }: { day: string; onClose: () => void }) {
  const valid = DATE_RE.test(day);
  const [data, setData] = useState<SackMovementsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!valid) {
      setError('malformed day');
      return;
    }
    getSackMovements(day, day)
      .then((r) => { if (!cancelled) { setData(r.data); setError(null); } })
      .catch((e) => { if (!cancelled) setError(String((e as Error).message ?? e)); });
    return () => { cancelled = true; };
  }, [day, valid, tick]);

  const S = W.sacks;
  const weighed = data?.weighed.find((w) => w.day === day) ?? null;

  return (
    <Sheet title={S.sheetTitle} eyebrow={valid ? S.sheetEyebrow(fmtDayLong(day)) : S.sheetTitle} onClose={onClose}>
      {error ? (
        <Failed error={error} onRetry={valid ? () => setTick((t) => t + 1) : undefined} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <div className="big" style={{ fontSize: 'var(--fs-head)' }}>{fmtDayLong(day)}</div>
          <p style={{ marginTop: 8 }}>
            {weighed && weighed.sacks > 0 ? S.sheetWeighed(fmtInt(weighed.sacks), fmtInt(Math.round(weighed.kg))) : S.sheetWeighedNone}
          </p>

          {data.movements.length === 0 ? (
            <p className="state">{S.sheetEmpty}</p>
          ) : (
            <table style={{ marginTop: 22 }}>
              <thead>
                <tr>
                  <th style={{ width: '7em' }}>{S.colTime}</th>
                  <th>{S.colWhat}</th>
                  <th className="n" style={{ width: '5em' }}>{S.colSacks}</th>
                  <th className="n" style={{ width: '6em' }}>{S.colKg}</th>
                  <th>{S.colProduct}</th>
                  <th>{S.colWho}</th>
                  <th>{S.colWhy}</th>
                </tr>
              </thead>
              <tbody>
                {data.movements.map((m) => (
                  <tr key={m.movementId}>
                    <td>{fmtClock(m.occurredAtPlant)}</td>
                    <td>{S.typeName[m.movementType]}</td>
                    <td className="n">{m.quantitySacks > 0 ? fmtInt(m.quantitySacks) : `−${fmtInt(-m.quantitySacks)}`}</td>
                    <td className="n">{m.quantityKg == null ? <span className="g">—</span> : fmtKg(Math.abs(m.quantityKg)).replace(/^/, m.quantityKg < 0 ? '−' : '')}</td>
                    <td className={m.productName ? '' : 'g'}>{m.productName ?? (m.materialId == null ? S.anyProduct : `Product ${m.materialId}`)}</td>
                    <td>
                      {m.recordedBy?.name ?? W.health.noActor}
                      <span className="mut sm"> · {S.colRecorded.toLowerCase()} {fmtAppInstant(m.recordedAtUtc)}</span>
                    </td>
                    <td className={m.reason ? '' : 'g'}>{m.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="mut sm" style={{ marginTop: 22, maxWidth: '80ch' }}>{S.recordNote} {data.machineLevel.reason}</p>
        </>
      )}
    </Sheet>
  );
}
