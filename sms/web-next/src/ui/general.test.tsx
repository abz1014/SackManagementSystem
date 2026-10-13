import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Sheet } from './Sheet';
import { Skeleton } from './Skeleton';
import { ErrorState } from './ErrorState';
import { EmptyState } from './EmptyState';
import { DataTable, type Column } from './DataTable';
import { Disclosure } from './Disclosure';
import { Tabs } from './Tabs';
import { Segmented } from './Segmented';
import { Chip } from './Chip';
import { ToastProvider, useToast } from './Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Sheet', () => {
  function Host({ onClosed }: { onClosed?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button onClick={() => setOpen(true)}>trigger</button>
        <Sheet
          open={open}
          onClose={() => {
            setOpen(false);
            onClosed?.();
          }}
          title="Station 3"
        >
          <button>inside a</button>
          <button>inside b</button>
        </Sheet>
      </div>
    );
  }

  it('moves focus in, traps Tab, closes on Esc and returns focus to the trigger', () => {
    render(<Host />);
    const trigger = screen.getByText('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    const close = screen.getByLabelText('Close');
    const b = screen.getByText('inside b');
    b.focus();
    fireEvent.keyDown(b, { key: 'Tab' });
    expect(document.activeElement).toBe(close); // wrapped from last to first
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(b); // and back

    fireEvent.keyDown(b, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens from the URL sheet ref only for its own kind', () => {
    const { rerender } = render(
      <Sheet sheet={{ kind: 'cone', id: '7' }} kind="station" onClose={() => {}} title="t">
        x
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <Sheet sheet={{ kind: 'station', id: '7' }} kind="station" onClose={() => {}} title="t">
        x
      </Sheet>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('Skeleton', () => {
  beforeEach(() => vi.useFakeTimers());

  it('switches to the "Taking too long" error after 10 s, naming the part', () => {
    render(<Skeleton part="the reject chart" height={120} />);
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/the reject chart is taking too long/);
  });

  it('shows no numbers while loading', () => {
    render(<Skeleton part="x" />);
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

describe('ErrorState', () => {
  it('names the failed part and offers Try again', () => {
    const retry = vi.fn();
    render(<ErrorState part="the reject chart" onRetry={retry} />);
    expect(screen.getByText("Couldn't load the reject chart.")).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Check Diagnostics')).toBeNull();
  });

  it('adds the Diagnostics link after repeated failure', () => {
    render(<ErrorState part="the table" attempts={2} />);
    expect(screen.getByText('Check Diagnostics').getAttribute('href')).toContain('t=diagnostics');
  });
});

describe('EmptyState', () => {
  it('states the newest data and offers to show it', () => {
    const show = vi.fn();
    render(<EmptyState newest="2026-09-07T12:00:28Z" onShowNewest={show} />);
    expect(screen.getByText('Nothing in this period. Newest data: 7 Sep 2026.')).toBeTruthy();
    fireEvent.click(screen.getByText('Show 7 Sep 2026'));
    expect(show).toHaveBeenCalledOnce();
  });

  it('without a newest reading draws no action', () => {
    render(<EmptyState onShowNewest={() => {}} />);
    expect(screen.getByText('Nothing in this period.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('DataTable', () => {
  interface R {
    id: string;
    name: string;
    n: number;
  }
  const cols: Column<R>[] = [
    { key: 'name', header: 'Name', sortValue: (r) => r.name },
    { key: 'n', header: 'Cones', numeric: true, sortValue: (r) => r.n },
  ];
  const rows: R[] = [
    { id: 'a', name: 'B', n: 2 },
    { id: 'b', name: 'A', n: 3 },
    { id: 'c', name: 'C', n: 1 },
  ];

  it('sets aria-sort, sorts, and shows the range text with load more', () => {
    const more = vi.fn();
    render(<DataTable caption="Cone list" columns={cols} rows={rows} rowKey={(r) => r.id} total={1204} hasMore onLoadMore={more} />);
    const th = screen.getByText('Cones').closest('th')!;
    expect(th.getAttribute('aria-sort')).toBe('none');
    fireEvent.click(screen.getByText('Cones'));
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getAllByRole('row')[1]!.textContent).toContain('C');
    fireEvent.click(screen.getByText('Cones'));
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByText('Showing 1–3 of 1,204')).toBeTruthy();
    fireEvent.click(screen.getByText('Load more'));
    expect(more).toHaveBeenCalledOnce();
  });

  it('opens a row on click and on Enter', () => {
    const open = vi.fn();
    render(<DataTable caption="Cone list" columns={cols} rows={rows} rowKey={(r) => r.id} onRowOpen={open} />);
    const row = screen.getByText('A').closest('tr')!;
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('keeps the header and shows the error in the body, never an empty table', () => {
    render(<DataTable caption="Cone list" columns={cols} rows={[]} rowKey={(r) => r.id} error={<ErrorState part="the cone list" />} />);
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText("Couldn't load the cone list.")).toBeTruthy();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });
});

describe('Disclosure', () => {
  beforeEach(() => window.localStorage.clear());

  it('remembers open state per section id', () => {
    const { unmount } = render(<Disclosure id="weight-calc">body text</Disclosure>);
    const sum = screen.getByText('How this is calculated');
    expect(sum.closest('details')!.hasAttribute('open')).toBe(false);
    fireEvent.click(sum);
    expect(sum.closest('details')!.hasAttribute('open')).toBe(true);
    expect(window.localStorage.getItem('sms.disclosure.weight-calc')).toBe('1');
    unmount();

    render(<Disclosure id="weight-calc">body text</Disclosure>);
    expect(screen.getByText('How this is calculated').closest('details')!.hasAttribute('open')).toBe(true);
    cleanup();
    render(<Disclosure id="other">body text</Disclosure>);
    expect(screen.getByText('How this is calculated').closest('details')!.hasAttribute('open')).toBe(false);
  });

  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<Disclosure id="x">b</Disclosure>);
    fireEvent.click(screen.getByText('How this is calculated'));
    expect(screen.getByText('How this is calculated').closest('details')!.hasAttribute('open')).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('Tabs, Segmented, Chip, Toast', () => {
  it('Tabs: arrow keys move selection', () => {
    const change = vi.fn();
    render(<Tabs label="Quality" items={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} value="a" onChange={change} />);
    fireEvent.keyDown(screen.getByText('A'), { key: 'ArrowRight' });
    expect(change).toHaveBeenCalledWith('b');
    expect(screen.getByText('A').getAttribute('aria-selected')).toBe('true');
  });

  it('Segmented: shows the reason for a disabled option', () => {
    render(<Segmented label="View" value="a" onChange={() => {}} options={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B', disabledReason: 'No data' }]} />);
    expect((screen.getByText('B') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('B').getAttribute('title')).toBe('No data');
  });

  it('Chip: removable chip names what it removes', () => {
    const rm = vi.fn();
    render(<Chip onRemove={rm}>Winder 4</Chip>);
    fireEvent.click(screen.getByLabelText('Remove Winder 4'));
    expect(rm).toHaveBeenCalled();
  });

  it('Toast: disappears after 5 s unless it has an action', () => {
    vi.useFakeTimers();
    function Fire() {
      const t = useToast();
      return (
        <>
          <button onClick={() => t('Published.')}>go</button>
          <button onClick={() => t('Deleted.', { action: { label: 'Undo', onClick: () => {} } })}>del</button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Fire />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    fireEvent.click(screen.getByText('del'));
    expect(screen.getByText('Published.')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5_001);
    });
    expect(screen.queryByText('Published.')).toBeNull();
    expect(screen.getByText('Deleted.')).toBeTruthy();
  });
});
