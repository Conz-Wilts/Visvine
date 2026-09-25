import type { ReactNode } from 'react';
import { cx } from './cx';

export type ChipTone = 'neutral' | 'accent' | 'danger' | 'warn' | 'info';

export interface ChipProps {
  tone?: ChipTone;
  className?: string;
  children: ReactNode;
}

export function Chip({ tone = 'neutral', className, children }: ChipProps) {
  return <span className={cx('vv-chip', tone !== 'neutral' && `vv-chip--${tone}`, className)}>{children}</span>;
}
