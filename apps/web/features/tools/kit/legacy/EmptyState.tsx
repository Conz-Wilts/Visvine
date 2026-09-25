import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** A button that gets the reader out of the empty state. */
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="vv-empty">
      <span className="vv-empty__title">{title}</span>
      {description && <span className="vv-empty__description">{description}</span>}
      {action}
    </div>
  );
}
