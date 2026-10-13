import { C } from '../copy';
import { StatusPill, type UiState } from './StatusPill';
import '../components/state.css';

/** An item exactly as the server states it. Nothing is added or reworded here. */
export interface AttentionItem {
  id: string | number;
  state: UiState;
  /** The sentence, from the server. */
  sentence: string;
  /** Already-formatted time. */
  time?: string;
}

export interface AttentionListProps {
  items: AttentionItem[];
  onOpen?: (item: AttentionItem) => void;
}

export function AttentionList({ items, onOpen }: AttentionListProps) {
  return (
    <section className="attn" aria-label={C.attention}>
      <h2 className="attn-title">{C.attention}</h2>
      {items.length === 0 ? (
        <p className="attn-empty">
          <StatusPill state="ok" compact /> <span>{C.nothingNeedsAttention}</span>
        </p>
      ) : (
        <ul className="attn-list">
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" className="attn-row" onClick={() => onOpen?.(it)}>
                <StatusPill state={it.state} />
                <span className="attn-sentence">{it.sentence}</span>
                {it.time && <span className="attn-time">{it.time}</span>}
                <span className="attn-chev" aria-hidden="true">{'›'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
