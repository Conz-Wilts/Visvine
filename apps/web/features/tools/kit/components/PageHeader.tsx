import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/**
 * A heading row. The app's band already names the Tool and carries its
 * sections and buttons (`surfaces.nav`, `surfaces.actions`), so this is for a
 * heading inside the Tool's own content — never a second title bar.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
