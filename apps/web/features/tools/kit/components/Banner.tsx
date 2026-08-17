import type { ReactNode } from 'react';
import { cx } from './cx';

export type BannerTone = 'info' | 'success' | 'warn' | 'danger';

export interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  /** Rendered at the end of the row — usually a retry or dismiss button. */
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * The kit's way of failing visibly: a Tool that cannot do something says so in
 * its own pane rather than rendering nothing.
 */
export function Banner({ tone = 'info', title, action, children }: BannerProps) {
  return (
    <div className={cx('vv-banner', `vv-banner--${tone}`)} role={tone === 'danger' ? 'alert' : undefined}>
      <div>
        {title && <div className="vv-banner__title">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}
