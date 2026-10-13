import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../../../web/src/testkit/render';
import { useData } from './useData';
import { useMulti } from './useMulti';

function Probe({ bad }: { bad: string[] }) {
  const mk = (name: string) => () => (bad.includes(name) ? Promise.reject(new Error('no')) : Promise.resolve({ n: 5 }));
  const a = useData('weighed', mk('weighed'), 'a', { live: false });
  const b = useData('rejects', mk('rejects'), 'b', { live: false });
  const c = useData('sacks', mk('sacks'), 'c', { live: false });
  const m = useMulti({ a, b, c });
  return <div data-testid="m">{m.status}|{m.failed.join(',')}</div>;
}

describe('useMulti', () => {
  it('is loading until all settle', () => {
    render(<Probe bad={[]} />);
    expect(screen.getByTestId('m').textContent).toMatch(/^loading/);
  });
  it('names exactly the failed part', async () => {
    render(<Probe bad={['rejects']} />);
    await waitFor(() => expect(screen.getByTestId('m').textContent).toBe('error|rejects'));
  });
  it('ok when none failed', async () => {
    render(<Probe bad={[]} />);
    await waitFor(() => expect(screen.getByTestId('m').textContent).toBe('ok|'));
  });
});
