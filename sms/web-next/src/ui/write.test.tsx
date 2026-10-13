import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import '../../../web/src/testkit/render';
import { WriteGate } from './WriteGate';
import { ConfirmDialog } from './ConfirmDialog';
import { Wizard } from './Wizard';
import { ReasonField, reasonValid } from './Field';

const REASON = 'Writes are switched off on this server until IFL confirms.';

describe('WriteGate', () => {
  it('below rank renders nothing at all', () => {
    const { container } = render(<WriteGate rank={1} minRank={2} disabledReason={REASON}><button>Execute</button></WriteGate>);
    expect(container.innerHTML).toBe('');
  });
  it('at rank with writes off: disabled, lock, reason verbatim, described by', () => {
    const { container } = render(<WriteGate rank={2} minRank={2} disabledReason={REASON}><button>Execute</button></WriteGate>);
    const b = screen.getByRole('button', { name: 'Execute' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    const reason = screen.getByText(REASON);
    expect(b.getAttribute('aria-describedby')).toBe(reason.parentElement!.id);
    expect(container.querySelector('[data-icon="lock"]')).toBeTruthy();
  });
  it('at rank with writes on: enabled', () => {
    render(<WriteGate rank={3} minRank={2} disabledReason={null}><button>Execute</button></WriteGate>);
    expect((screen.getByRole('button', { name: 'Execute' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('no optimistic UI', () => {
  function Harness({ run }: { run: () => Promise<string> }) {
    const [result, setResult] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    return (
      <>
        <WriteGate rank={2} minRank={2}>
          <button onClick={() => { run().then(setResult, (e: Error) => setErr(e.message)); }}>Execute</button>
        </WriteGate>
        {result && <p>{result}</p>}
        {err && <p role="alert">{err}</p>}
      </>
    );
  }
  it('result appears only after the promise resolves', async () => {
    let resolve!: (v: string) => void;
    render(<Harness run={() => new Promise<string>((r) => { resolve = r; })} />);
    fireEvent.click(screen.getByText('Execute'));
    expect(screen.queryByText('Done on the server')).toBeNull();
    resolve('Done on the server');
    await waitFor(() => expect(screen.getByText('Done on the server')).toBeTruthy());
  });
  it('rejection shows the server message verbatim', async () => {
    render(<Harness run={() => Promise.reject(new Error('Material already exist'))} />);
    fireEvent.click(screen.getByText('Execute'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Material already exist'));
  });
});

describe('ConfirmDialog', () => {
  it('focuses Cancel by default and Esc cancels', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Retire product" confirmLabel="Retire" onConfirm={onConfirm} onCancel={onCancel}>Sure?</ConfirmDialog>);
    expect(document.activeElement).toBe(screen.getByText('Cancel'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('traps Tab', () => {
    render(<ConfirmDialog open title="T" confirmLabel="Retire" onConfirm={() => {}} onCancel={() => {}}>x</ConfirmDialog>);
    screen.getByText('Retire').focus();
    fireEvent.keyDown(screen.getByText('Retire'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('Cancel'));
  });
});

describe('Wizard', () => {
  const steps = [{ id: 'plan', label: 'Plan' }, { id: 'review', label: 'Review' }, { id: 'exec', label: 'Execute' }];
  it('Next is disabled with a visible reason', () => {
    const onStep = vi.fn();
    render(<Wizard steps={steps} current={0} onStep={onStep} nextBlockedReason="Choose a blend first.">x</Wizard>);
    const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    const why = screen.getByText('Choose a blend first.');
    expect(next.getAttribute('aria-describedby')).toBe(why.id);
    fireEvent.click(next);
    expect(onStep).not.toHaveBeenCalled();
  });
  it('enabled Next advances; last step shows final action', () => {
    const onStep = vi.fn();
    const { rerender } = render(<Wizard steps={steps} current={0} onStep={onStep}>x</Wizard>);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onStep).toHaveBeenCalledWith(1);
    rerender(<Wizard steps={steps} current={2} onStep={onStep} finalAction={<button>Run it</button>}>x</Wizard>);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run it' })).toBeTruthy();
  });
});

describe('ReasonField', () => {
  it('counts and validates the 10 character minimum', () => {
    const Host = () => { const [v, s] = useState(''); return <ReasonField label="Reason" value={v} onChange={s} />; };
    render(<Host />);
    expect(screen.getByText('0 of 10 characters minimum')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'too short' } });
    expect(screen.getByText('9 of 10 characters minimum')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'long enough' } });
    expect(screen.getByText('11 characters')).toBeTruthy();
    expect(reasonValid('too short')).toBe(false);
    expect(reasonValid('  ten chars!  ')).toBe(true);
  });
});
