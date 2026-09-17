'use client';

import { clsx } from 'clsx';

/**
 * Flat settings section used across the Space Console panes, styled after
 * the profile settings page: small bold heading, muted one-liner, and a
 * hairline divider between siblings (stack sections inside a `space-y-8`
 * container). No card chrome — children render directly under the header.
 */
interface SettingsSectionProps {
  /** Usually a plain string; a node when the heading carries a glyph. */
  title: React.ReactNode;
  /** One-line supporting text under the title. */
  description?: React.ReactNode;
  /** Optional node pinned to the right of the header (e.g. a button). */
  action?: React.ReactNode;
  className?: string;
  /** Drop the hairline above the section — spacing alone separates it. */
  flush?: boolean;
  /** A larger title — the size of the General tab's field labels. */
  large?: boolean;
  children: React.ReactNode;
}

export default function SettingsSection({
  title,
  description,
  action,
  className,
  flush = false,
  large = false,
  children,
}: SettingsSectionProps) {
  return (
    <section
      className={clsx(
        !flush && 'border-t border-border-subtle pt-8 first:border-t-0 first:pt-0',
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className={clsx(large ? 'text-base' : 'text-sm', 'mb-1 font-semibold text-text-primary')}>{title}</h3>
          {description && <p className="text-xs text-text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
