import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';
import { Button as UIButton } from '@visvine/ui';

/** The kit's names for the app's button variants; the app's own names work too. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand' | 'neutral' | 'danger-text';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** Shows the app's spinner and disables the button. */
  loading?: boolean;
  loadingText?: string;
  children: ReactNode;
}

const VARIANT: Record<ButtonVariant, 'brand' | 'neutral' | 'ghost' | 'danger' | 'danger-text'> = {
  primary: 'brand',
  secondary: 'neutral',
  ghost: 'ghost',
  danger: 'danger',
  brand: 'brand',
  neutral: 'neutral',
  'danger-text': 'danger-text',
};

/**
 * The app's own button (@visvine/ui). Defaults to `secondary` and
 * `type="button"`: a Tool's buttons are usually actions inside a pane, and an
 * accidental form submit inside a sandboxed frame reloads the document out
 * from under the runtime.
 */
export function Button({ variant = 'secondary', size = 'md', type = 'button', ...rest }: ButtonProps) {
  if (VARIANT[variant] === 'brand') return <PrimaryButton type={type} {...rest} />;
  return <UIButton type={type} variant={VARIANT[variant]} size={size} {...rest} />;
}

/**
 * The primary action, filled with the accent's strong shade and its inverse
 * text: the accent's default fill is a pastel that white text cannot be read
 * on (under 2:1), and a Tool's main act has to read as pressable.
 */
function PrimaryButton({ loading, loadingText, children, disabled, className, ...rest }: Omit<ButtonProps, 'variant' | 'size'>) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-fg-inverse transition-all hover:opacity-90 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
      {...rest}
    >
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
