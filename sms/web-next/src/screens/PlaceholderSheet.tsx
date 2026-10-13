import { Sheet } from '../ui/Sheet';
import { C } from '../copy';
import { legacyHref } from './legacyHref';
import type { SheetProps } from './registry';

export function PlaceholderSheet({ route, onClose }: SheetProps) {
  return (
    <Sheet open onClose={onClose} title={C.app.placeholderSheet}>
      <p>
        <a className="ui-link" href={legacyHref(route)}>
          {C.app.openCurrent}
        </a>
      </p>
    </Sheet>
  );
}
