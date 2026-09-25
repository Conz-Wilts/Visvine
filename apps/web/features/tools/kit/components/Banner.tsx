import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export type BannerTone = 'info' | 'success' | 'warn' | 'danger';

export interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  /** Rendered at the end of the row — usually a retry or dismiss button. */
  action?: ReactNode;
  children?: ReactNode;
}

/** The app's notice (@visvine/ui's Alert): a 2px rule in the tone's colour, then the words. */
const RULE: Record<BannerTone, string> = {
  info: 'border-info-bright text-info',
  success: 'border-success text-success',
  warn: 'border-warning-bright text-warning',
  danger: 'border-danger-bright text-danger-strong',
};

/**
 * The kit's way of failing visibly: a Tool that cannot do something says so in
 * its own pane rather than rendering nothing.
 */
export function Banner({ tone = 'info', title, action, children }: BannerProps) {
  return (
    <div
      className={clsx('flex items-start justify-between gap-3 border-l-2 py-1 pl-4 text-sm', RULE[tone])}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}
