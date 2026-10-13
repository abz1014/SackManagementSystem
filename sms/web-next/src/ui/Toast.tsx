import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { U } from './strings';
import './components/Toast.css';

export interface ToastOptions {
  /** Stays until dismissed (errors, or a toast with an action such as Undo). */
  persist?: boolean;
  action?: { label: string; onClick: () => void };
  /** Default 5000 ms. */
  durationMs?: number;
}
interface Item extends ToastOptions {
  id: number;
  message: string;
}
type Push = (message: string, opts?: ToastOptions) => void;

const Ctx = createContext<Push | null>(null);

/** One line, the same verb as the button that caused it ("Published."). */
export function useToast(): Push {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast needs a <ToastProvider>');
  return c;
}

function ToastView({ item, onDone }: { item: Item; onDone: (id: number) => void }) {
  const sticky = item.persist || !!item.action;
  useEffect(() => {
    if (sticky) return;
    const t = setTimeout(() => onDone(item.id), item.durationMs ?? 5000);
    return () => clearTimeout(t);
  }, [item, sticky, onDone]);
  return (
    <div className="ui-toast" role="status">
      <span>{item.message}</span>
      {item.action && (
        <button
          type="button"
          className="ui-toast__btn"
          onClick={() => {
            item.action!.onClick();
            onDone(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      {sticky && (
        <button type="button" className="ui-toast__btn" onClick={() => onDone(item.id)}>
          {U.dismiss}
        </button>
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const n = useRef(0);
  const done = useCallback((id: number) => setItems((l) => l.filter((i) => i.id !== id)), []);
  const push = useCallback<Push>((message, opts = {}) => setItems((l) => [...l, { ...opts, message, id: ++n.current }]), []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="ui-toasts" aria-live="polite">
        {items.map((i) => (
          <ToastView key={i.id} item={i} onDone={done} />
        ))}
      </div>
    </Ctx.Provider>
  );
}
