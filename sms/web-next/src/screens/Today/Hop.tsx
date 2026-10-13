import type { ReactNode } from 'react';
import type { Route } from '../../route';
import { hrefFor, plainClick } from '../../ui/nav';

/** A link that navigates in-app on a plain click and stays a real link otherwise (open in new tab works). */
export function Hop({ to, go, children }: { to: Route; go: (r: Route) => void; children: ReactNode }) {
  return (
    <a className="ui-link" href={hrefFor(to)} onClick={(e) => plainClick(e, () => go(to))}>
      {children}
    </a>
  );
}
