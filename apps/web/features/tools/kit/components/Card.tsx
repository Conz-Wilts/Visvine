import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export interface CardProps {
  title?: ReactNode;
  /** Rendered opposite the title — a button or a chip. */
  actions?: ReactNode;
  /** Drop the vertical padding, for a section that holds a full-bleed table. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A section of the page. App surfaces are flat — hairline sections, never a
 * boxed card — so this draws the section the app draws: its title row, its
 * content, a hairline under it.
 */
export function Card({ title, actions, flush = false, className, children }: CardProps) {
  return (
    <section className={clsx('border-b border-line-subtle', flush ? 'pb-0' : 'py-4', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-fg">{title}</span>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
