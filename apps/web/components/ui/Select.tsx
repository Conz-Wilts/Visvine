'use client';

import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Standard native select — one size everywhere (h-10, text-sm, rounded-lg)
 * with a consistent custom chevron. `className` applies to the wrapper, so
 * width utilities (`w-full`, `w-48`, …) work as expected; in flex rows it
 * shrinks to fit like a plain select.
 */
export default function Select({ className, children, ...props }: SelectProps) {
  return (
    <div className={clsx('relative', className)}>
      <select
        {...props}
        className="h-10 w-full appearance-none rounded-lg border border-border-default bg-surface-1 pl-3 pr-9 text-sm text-text-primary transition-colors focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
    </div>
  );
}
