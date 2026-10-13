import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sheet } from './Sheet';
import { Disclosure } from './Disclosure';
import { TopBar } from './TopBar';
import { markingZoom, pageIsZoomed } from '../charts/zoomMarker';
import { UI_SCALE_KEY } from './uiScale';

const user = { username: 'asma', displayName: 'Asma', role: 'admin' };
beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/?s=today');
  document.documentElement.removeAttribute('data-ui-scale');
});
afterEach(cleanup);

describe('Sheet focus trap (CSS-074)', () => {
  const mount = () =>
    render(
      <Sheet open onClose={() => {}} title="t">
        <button type="button">One</button>
        <Disclosure id="t" label="More">
          <button type="button">Inside</button>
        </Disclosure>
      </Sheet>,
    );
  it('treats a Disclosure summary as the last stop, not the control hidden inside it', () => {
    mount();
    const summary = document.querySelector('summary') as HTMLElement;
    summary.focus();
    fireEvent.keyDown(summary, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(summary);
  });
});

describe('User menu (CSS-039, CSS-063)', () => {
  const bar = () => render(<TopBar title="Today" user={user} onOpenAccount={() => {}} onSignOut={() => {}} />);
  it('Escape closes the menu and returns focus to the menu button', () => {
    bar();
    const btn = document.querySelector('.sh-user-btn') as HTMLElement;
    fireEvent.click(btn);
    const item = screen.getByRole('menuitem', { name: /Account/ });
    item.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
  it('an outside click closes it', () => {
    bar();
    fireEvent.click(document.querySelector('.sh-user-btn') as HTMLElement);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('offers Desk and Wall, saves under the old key and sets --ui-scale', () => {
    bar();
    fireEvent.click(document.querySelector('.sh-user-btn') as HTMLElement);
    const wall = screen.getByRole('menuitemradio', { name: 'Wall' });
    expect(screen.getByRole('menuitemradio', { name: 'Desk' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(wall);
    expect(window.localStorage.getItem(UI_SCALE_KEY)).toBe('1.3');
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.3');
    expect(wall.getAttribute('aria-checked')).toBe('true');
  });
  it('starts from the saved Wall size', () => {
    window.localStorage.setItem(UI_SCALE_KEY, '1.3');
    bar();
    expect(document.documentElement.dataset.uiScale).toBe('1.3');
  });
});

describe('Zoomed in - Back (CSS-053)', () => {
  it('stamps the entry a zoom pushed, shows the top-bar control, and Back undoes it', () => {
    render(<TopBar title="Today" user={user} onOpenAccount={() => {}} onSignOut={() => {}} />);
    expect(screen.queryByRole('button', { name: /Zoomed in/ })).toBeNull();
    const zoom = markingZoom<string>((q) => window.history.pushState(null, '', `/?s=today&p=${q}`));
    act(() => zoom('x'));
    expect(pageIsZoomed()).toBe(true);
    const back = screen.getByRole('button', { name: /Zoomed in/ });
    const spy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    fireEvent.click(back);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('does not mark a zoom that changed nothing', () => {
    const zoom = markingZoom<string>(() => {});
    zoom('x');
    expect(pageIsZoomed()).toBe(false);
  });
});
