/**
 * The landing: five cards (the management summary featured, four beside it), each naming who it is for, what it
 * gives and in which formats. Every report type is a button inside its card, so every `rt` stays one click away
 * and IFL's eight sit in IFL's own numbering (decision E-5): "IFL report 6" is found by the number in their email.
 */
import { C, withFragments, FRAGMENTS } from '../../copy';
import type { ReactNode } from 'react';
import type { ReportType } from '../../bridge/api';
import { canRead, CARDS, type ReportCard } from './model';
const R = withFragments(C.reports, FRAGMENTS.reportsParts);

const ICON: Record<ReportCard['id'], ReactNode> = {
  summary: <path d="M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5M7.5 10h5M7.5 13h5" />,
  production: (
    <>
      <rect x="3" y="4.5" width="14" height="12.5" rx="1.5" />
      <path d="M3 8.5h14M7 2.5v3M13 2.5v3" />
    </>
  ),
  rejects: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" />
    </>
  ),
  sacks: <path d="M5 5l2-2.5h6L15 5l1.5 12h-13zM7 8.5h6" />,
  machine: <path d="M3 15h14M5 15V8l3-2v9M11 15V5l4 2v8" />,
};

function CardIcon({ id }: { id: ReportCard['id'] }) {
  return (
    <span className="rp-card__ico" aria-hidden="true">
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {ICON[id]}
      </svg>
    </span>
  );
}

export interface CardsProps {
  rank: number;
  type: ReportType;
  onPick: (t: ReportType) => void;
}

function Card({ card, rank, type, onPick, featured }: CardsProps & { card: ReportCard; featured?: boolean }) {
  const selected = card.variants.some((x) => x.type === type);
  const first = card.variants[0]!;
  const locked = !canRead(first.type, rank) && card.variants.every((x) => !canRead(x.type, rank));
  const headId = `rp-card-${card.id}`;
  return (
    <section className={`rp-card${featured ? ' rp-card--feat' : ''}`} data-selected={selected ? '' : undefined} aria-labelledby={headId}>
      <div className="rp-card__head">
        <CardIcon id={card.id} />
        <div>
          <h3 id={headId} className="rp-card__title">{card.title}</h3>
          <span className="rp-card__who">{card.who}</span>
        </div>
        {featured && <span className="rp-card__badge">{R.startHere}</span>}
      </div>
      <p className="rp-card__what">{card.what}</p>
      {(card.variants.length > 1 || locked) && (
        <ul className="rp-items">
          {card.variants.map((x) => {
            const readable = canRead(x.type, rank);
            return (
              <li key={x.type}>
                <button
                  type="button"
                  className="rp-item"
                  aria-pressed={x.type === type}
                  disabled={!readable}
                  onClick={() => onPick(x.type)}
                >
                  <span className="rp-item__title">{x.title}</span>
                  <span className="rp-item__hint">{x.hint}</span>
                  {x.ifl !== null && <span className="rp-item__ifl">{R.ifl(x.ifl)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="rp-card__foot">
        <div className="rp-fmts" aria-label="Formats">
          <span>PDF</span>
          <span>Excel</span>
          <span>CSV</span>
        </div>
        {locked ? (
          <span className="rp-lock" title={R.managerOnlyHint}>{R.managerOnly}</span>
        ) : (
          <button type="button" className={`rp-use${selected ? ' rp-use--on' : ''}`} aria-pressed={selected} onClick={() => onPick(selected ? type : first.type)}>
            {selected ? R.inUse : R.useThis}
          </button>
        )}
      </div>
      {locked && <p className="rp-card__lockhint">{R.managerOnlyHint}</p>}
    </section>
  );
}

export function Cards(props: CardsProps) {
  const [summary, ...rest] = CARDS;
  return (
    <div className="rp-cards">
      <Card {...props} card={summary!} featured />
      <div className="rp-cards__sub">
        {rest.map((c) => (
          <Card key={c.id} {...props} card={c} />
        ))}
      </div>
    </div>
  );
}
