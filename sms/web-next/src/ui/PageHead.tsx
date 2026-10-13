import type { ReactNode } from 'react';
import './components/PageHead.css';

export interface PageHeadProps {
  /** The one h1 of the page. */
  title: string;
  /** One sentence under it saying what this page answers. */
  sentence?: ReactNode;
  /** Buttons or links for the right of the head ("Open TV wall"). */
  actions?: ReactNode;
}

/** One h1, one sentence, optional actions. Every page opens with this (fix-wave D16). */
export function PageHead({ title, sentence, actions }: PageHeadProps) {
  return (
    <header className="ui-pagehead">
      <div className="ui-pagehead__text">
        <h1 className="ui-pagehead__title">{title}</h1>
        {sentence != null && sentence !== '' && <p className="ui-pagehead__sentence">{sentence}</p>}
      </div>
      {actions && <div className="ui-pagehead__actions">{actions}</div>}
    </header>
  );
}
