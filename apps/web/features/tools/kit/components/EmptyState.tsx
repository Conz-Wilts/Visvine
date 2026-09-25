import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** A button that gets the reader out of the empty state. */
  action?: ReactNode;
}

/**
 * The app's empty state (@visvine/ui's shape): a line of muted text, centred,
 * and the one thing to do about it. No tile — an empty surface is the
 * quietest thing on the page.
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <p className="text-fg-muted">{description ?? title}</p>
      {action}
    </div>
  );
}
