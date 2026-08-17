import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/**
 * A Tool renders inside the app's content area, which already carries the page
 * chrome — so this is a heading row, not a title bar, and it never tries to
 * look like one.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="vv-page-header">
      <div>
        <h1 className="vv-page-header__title">{title}</h1>
        {description && <p className="vv-page-header__description">{description}</p>}
      </div>
      {actions && <div className="vv-page-header__actions">{actions}</div>}
    </div>
  );
}
