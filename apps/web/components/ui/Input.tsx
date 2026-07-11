'use client';

import { forwardRef } from 'react';
import { clsx } from 'clsx';

/**
 * Shared soft-filled text input. Grey fill and no hard border at rest; on focus
 * the fill lifts to `surface-1` with a brand-green border + ring. Uses semantic
 * surface/text tokens so it stays legible in light and dark. Forwards all native
 * `<input>` props and merges `className`.
 */
export const inputBaseClass =
  'w-full rounded-xl bg-surface-2 border border-transparent px-4 py-3 text-base ' +
  'text-text-primary placeholder:text-text-muted transition-colors ' +
  'focus:bg-surface-1 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={clsx(inputBaseClass, className)} {...props} />;
});

export default Input;
