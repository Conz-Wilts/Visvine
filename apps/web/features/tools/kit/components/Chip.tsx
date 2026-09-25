import type { ReactNode } from 'react';
import { Chip as UIChip } from '@visvine/ui';

export type ChipTone = 'neutral' | 'accent' | 'danger' | 'warn' | 'info';

export interface ChipProps {
  tone?: ChipTone;
  className?: string;
  children: ReactNode;
}

/** Each tone paints from the viewer's theme, like the app's own chips. */
const TONE_COLOR: Record<Exclude<ChipTone, 'neutral'>, string> = {
  accent: 'var(--vv-color-accent)',
  danger: 'var(--vv-color-danger)',
  warn: 'var(--vv-color-warning)',
  info: 'var(--vv-color-info)',
};

/** The app's chip (@visvine/ui): muted by default, solid in a tone. */
export function Chip({ tone = 'neutral', className, children }: ChipProps) {
  return tone === 'neutral' ? (
    <UIChip tone="muted" className={className}>
      {children}
    </UIChip>
  ) : (
    <UIChip tone="solid" color={TONE_COLOR[tone]} className={className}>
      {children}
    </UIChip>
  );
}
