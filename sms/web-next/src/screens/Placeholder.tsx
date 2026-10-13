import { EmptyState } from '../ui/EmptyState';
import { C } from '../copy';
import { legacyHref } from './legacyHref';
import type { ScreenProps } from './registry';

/** Stands in for every screen that has not been rebuilt yet, so nothing is a dead end. */
export function Placeholder({ route }: ScreenProps) {
  return (
    <EmptyState
      message={
        <>
          {C.app.placeholder}{' '}
          <a className="ui-link" href={legacyHref(route)}>
            {C.app.openCurrent}
          </a>
        </>
      }
    />
  );
}
