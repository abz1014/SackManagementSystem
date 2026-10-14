import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../../web/src/testkit/render';
import { installFakeFetch } from '../../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../../web/src/testkit/fixtures';
import { PeriodChip } from './PeriodChip';
import { live } from '../bridge/lib';

const routes = { '/api/live': LIVE_FIXTURE, '/api/range': { minDate: '2026-08-05', maxDate: '2026-09-05' } };
const search = () => new URLSearchParams(window.location.search);

async function openPanel(url = '/') {
  window.history.replaceState(null, '', url);
  installFakeFetch(routes);
  render(<live.LiveProvider asOf={null}><PeriodChip /></live.LiveProvider>);
  const chip = await screen.findByRole('button', { name: /Change period/ });
  await waitFor(() => expect((chip as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(chip);
  await screen.findByRole('dialog');
  // wait until the plant-clock anchor (and the range) has landed
  await waitFor(() => expect((screen.getByRole('button', { name: 'Last week' }) as HTMLButtonElement).disabled).toBe(false));
}

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('PeriodChip and PeriodPanel', () => {
  it('shows the resolved period and compare tag', async () => {
    window.history.replaceState(null, '', '/?p=yesterday&cmp=prev');
    installFakeFetch(routes);
    render(<live.LiveProvider asOf={null}><PeriodChip /></live.LiveProvider>);
    const chip = await screen.findByRole('button', { name: /6 Sep/ });
    expect(chip.textContent).toContain('6 Sep');
    expect(chip.textContent).toContain('vs previous');
  });

  it('typing does not commit; Apply does', async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-09-03' } });
    fireEvent.change(screen.getByLabelText('From shift'), { target: { value: 'whole' } });
    fireEvent.change(screen.getByLabelText('To shift'), { target: { value: 'whole' } });
    expect(search().get('p')).toBeNull();
    expect(screen.getByText(/Shows 1 Sep – 3 Sep/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(search().get('p')).toBe('range');
    expect(search().get('from')).toBe('2026-09-01.morning');
    expect(search().get('to')).toBe('2026-09-03.night');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains an invalid range and disables Apply', async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-05' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-09-02' } });
    expect(screen.getByText('End is before start')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    // same day, evening start with a morning end is backwards too
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-09-05' } });
    fireEvent.change(screen.getByLabelText('From shift'), { target: { value: 'evening' } });
    fireEvent.change(screen.getByLabelText('To shift'), { target: { value: 'morning' } });
    expect(screen.getByText('End is before start')).toBeTruthy();
  });

  it('presets write the URL immediately and close', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(search().get('p')).toBe('yesterday');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Last week and Last month become pick ranges from the anchor', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Last week' }));
    expect(search().get('p')).toBe('pick');
    expect(search().get('from')).toBe('2026-08-31');
    expect(search().get('to')).toBe('2026-09-06');
    fireEvent.click(await screen.findByRole('button', { name: /Change period/ }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Last month' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    expect(search().get('from')).toBe('2026-08-01');
    expect(search().get('to')).toBe('2026-08-31');
  });

  it('compare writes cmp', async () => {
    await openPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'vs last week' }));
    expect(search().get('cmp')).toBe('week');
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    expect(search().get('cmp')).toBeNull();
  });

  it('offers the newest data day when the period is after it', async () => {
    await openPanel('/?p=range&from=2026-09-08.morning&to=2026-09-08.night');
    expect(screen.getByText('Newest data: 5 Sep 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to newest' }));
    expect(search().get('from')).toBe('2026-09-05.morning');
    expect(search().get('to')).toBe('2026-09-05.night');
  });

  it('shows no newest-data note for a period with data', async () => {
    await openPanel();
    expect(screen.queryByText(/Newest data/)).toBeNull();
  });

  it('Cancel and Esc discard the draft', async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(search().get('p')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Change period/ }));
    await screen.findByRole('dialog');
    expect((screen.getByLabelText('From date') as HTMLInputElement).value).not.toBe('2026-09-01');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-02' } });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(search().get('p')).toBeNull();
  });
});
