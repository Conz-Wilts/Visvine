import type { ReactNode } from 'react';
import { cx } from './cx';

export interface CardProps {
  title?: ReactNode;
  /** Rendered opposite the title — a button or a chip. */
  actions?: ReactNode;
  /** Drop the inner padding, for a card that holds a full-bleed table. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ title, actions, flush = false, className, children }: CardProps) {
  return (
    <div className={cx('vv-card', flush && 'vv-card--flush', className)}>
      {(title || actions) && (
        <div className="vv-card__header">
          <span className="vv-card__title">{title}</span>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
