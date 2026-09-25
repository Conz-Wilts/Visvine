import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  children: ReactNode;
}

/**
 * Defaults to `secondary` and `type="button"`: a Tool's buttons are usually
 * actions inside a pane, and an accidental form submit inside a sandboxed
 * frame reloads the document out from under the runtime.
 */
export function Button({ variant = 'secondary', size = 'md', className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx('vv-btn', `vv-btn--${variant}`, size === 'sm' && 'vv-btn--sm', className)}
    >
      {children}
    </button>
  );
}
