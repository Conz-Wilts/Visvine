import type { ReactNode } from 'react';
import { cx } from './cx';

export interface StackProps {
  direction?: 'row' | 'column';
  gap?: 'sm' | 'md' | 'lg';
  wrap?: boolean;
  className?: string;
  children: ReactNode;
}

/** The only layout primitive the kit ships — a flex row or column with a gap. */
export function Stack({ direction = 'column', gap = 'md', wrap = false, className, children }: StackProps) {
  return (
    <div
      className={cx(
        'vv-stack',
        direction === 'row' && 'vv-stack--row',
        gap !== 'md' && `vv-stack--${gap}`,
        wrap && 'vv-stack--wrap',
        className,
      )}
    >
      {children}
    </div>
  );
}
