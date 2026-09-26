import type { InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Input as UIInput } from '@visvine/ui';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * The app's own text input (@visvine/ui). A Tool's forms carry "e.g."
 * placeholders, so the placeholder is drawn a step lighter than the app's —
 * an example must never pass for a value already typed.
 */
export function Input({ className, ...props }: InputProps) {
  return <UIInput className={clsx('placeholder:text-fg-subtle!', className)} {...props} />;
}
