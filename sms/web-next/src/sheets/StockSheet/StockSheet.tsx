/**
 * Stock day sheet (`sheet=stock:<YYYY-MM-DD>`, TRACE A3-058, A6-S6, A1-084 getSackMovements).
 * One production day (06:00 to 06:00) of sack stock: the sacks the scale weighed (the derived receipts), then
 * every movement a person recorded, with who, when (plant time) and why. Nothing is editable; a correction is a
 * new row from the form on the Register's Sack stock tab.
 *
 * The movement time is the plant clock (24 hours); "recorded" is this system's own instant, in the viewer's zone.
 */
import { getSackMovements, type SackMovement } from '../../bridge/api';
import { fmt } from '../../bridge/lib';
import { RESERVED, formatClock, formatDate, C, FRAGMENTS, withFragments } from '../../copy';
import { useData } from '../../data';
import { DataTable, type Column } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/Skeleton';
import type { SheetProps } from '../../screens/registry';
import './stockSheet.css';
const R = withFragments(C.register, FRAGMENTS.registerParts);
const RF = FRAGMENTS.register;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function StockSheet({ route, onClose }: SheetProps) {
  const day = route.sheet?.kind === 'stock' ? route.sheet.id : '';
  const valid = DATE_RE.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00Z`));
  return (
    <Sheet open onClose={onClose} title={R.stockSheetTitle} width={640}>
      {valid ? <Body key={day} day={day} /> : <ErrorState part={RF.stockPart} cause={R.malformedDay} />}
    </Sheet>
  );
}

const signed = (n: number): string => (n > 0 ? fmt.fmtInt(n) : `−${fmt.fmtInt(-n)}`);

function Body({ day }: { day: string }) {
  const mv = useData(RF.stockPart, () => getSackMovements(day, day), `stock-day:${day}`, { live: false });

  if (mv.status === 'error') return <ErrorState part={RF.stockPart} cause={mv.error} onRetry={mv.refresh} />;
  if (!mv.data) return <Skeleton part={RF.stockPart} height={120} onRetry={mv.refresh} />;

  const d = mv.data.data;
  const weighed = d.weighed.find((w) => w.day === day) ?? null;

  const cols: Column<SackMovement>[] = [
    { key: 'time', header: R.colTime, render: (m) => formatClock(m.occurredAtPlant) },
    { key: 'what', header: R.colWhat, render: (m) => RESERVED.sackTypeName[m.movementType] },
    { key: 'sacks', header: R.colSacksQty, numeric: true, render: (m) => signed(m.quantitySacks) },
    {
      key: 'kg',
      header: R.colKgQty,
      numeric: true,
      render: (m) => (m.quantityKg === null ? '–' : `${m.quantityKg < 0 ? '−' : ''}${fmt.fmtKg(Math.abs(m.quantityKg))}`),
    },
    {
      key: 'product',
      header: R.fProduct,
      render: (m) => m.productName ?? (m.materialId === null ? R.fAnyProduct : `Product ${m.materialId}`),
    },
    {
      key: 'who',
      header: R.colWho,
      render: (m) => (
        <>
          {m.recordedBy?.name ?? R.nobody}
          <span className="sk-sub">{R.recordedAtOn(fmt.fmtAppInstant(m.recordedAtUtc))}</span>
        </>
      ),
    },
    { key: 'why', header: R.colWhy, render: (m) => m.reason ?? '–' },
  ];

  return (
    <div className="sk">
      <p className="sk-day">{R.stockSheetDay(formatDate(`${day}T12:00:00Z`))}</p>
      <p className="sk-weighed">
        {weighed && weighed.sacks > 0 ? R.stockWeighed(fmt.fmtInt(weighed.sacks), fmt.fmtInt(Math.round(weighed.kg))) : R.stockWeighedNone}
      </p>
      <DataTable<SackMovement>
        caption={R.stockSheetTitle}
        columns={cols}
        rows={d.movements}
        rowKey={(m) => String(m.movementId)}
        empty={<EmptyState message={R.stockEmpty} />}
      />
      <p className="sk-note">{R.recordNote} {d.machineLevel.reason}</p>
    </div>
  );
}
