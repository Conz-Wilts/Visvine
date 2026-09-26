'use client';

import { clsx } from 'clsx';
import { ChevronDownIcon } from './icons';
import { inputBaseClass } from './Input';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  /** `field` draws it as a form field, the same box as Input and Textarea beside it. */
  look?: 'control' | 'field';
};

/**
 * Standard native select — one size everywhere (h-10, text-sm, rounded-lg)
 * with a consistent custom chevron. `className` applies to the wrapper, so
 * width utilities (`w-full`, `w-48`, …) work as expected; in flex rows it
 * shrinks to fit like a plain select.
 */
export default function Select({ className, children, look = 'control', ...props }: SelectProps) {
  return (
    <div className={clsx('relative', className)}>
      <select
        {...props}
        className={
          look === 'field'
            ? clsx(inputBaseClass, 'appearance-none pr-10')
            : 'h-10 w-full appearance-none rounded-lg border border-line bg-surface pl-3 pr-9 text-sm text-fg transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50'
        }
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
    </div>
  );
}
