'use client';

import { forwardRef } from 'react';
import { clsx } from 'clsx';

/**
 * Shared quiet text input. A soft grey fill and no border at rest; on focus
 * the fill lifts to `surface` inside a single hairline ring in the ink
 * colour. The field is the one box a form is allowed — it is where you type —
 * so it stays understated rather than lit in the accent. Uses semantic
 * surface/text tokens so it stays legible in light and dark. Forwards all
 * native `<input>` props and merges `className`.
 */
export const inputBaseClass =
  'w-full rounded-lg bg-surface-subtle px-4 py-3 text-base ' +
  'text-fg placeholder:text-fg-muted transition-colors ' +
  'focus:bg-surface focus:outline-none focus:ring-1 focus:ring-line ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={clsx(inputBaseClass, className)} {...props} />;
});

export default Input;
