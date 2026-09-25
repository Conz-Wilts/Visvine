import { clsx } from 'clsx';

export interface SpinnerProps {
  size?: 'sm' | 'lg';
  /** Announced to screen readers; the spinner itself is decorative. */
  label?: string;
}

export function Spinner({ size = 'sm', label = 'Loading' }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={clsx(
        'inline-block animate-spin rounded-full border-2 border-line-subtle border-t-accent',
        size === 'lg' ? 'h-6 w-6' : 'h-4 w-4',
      )}
    />
  );
}
