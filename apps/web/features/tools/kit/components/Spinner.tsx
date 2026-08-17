import { cx } from './cx';

export interface SpinnerProps {
  size?: 'sm' | 'lg';
  /** Announced to screen readers; the spinner itself is decorative. */
  label?: string;
}

export function Spinner({ size = 'sm', label = 'Loading' }: SpinnerProps) {
  return <span className={cx('vv-spinner', size === 'lg' && 'vv-spinner--lg')} role="status" aria-label={label} />;
}
