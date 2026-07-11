'use client';

import { clsx } from 'clsx';

/**
 * Framed settings section used across the Community Console tabs. Gives every
 * group the same rounded card, hairline border, soft lift, and an icon-led
 * header so the forms read as a tidy stack of cards instead of a flat wall of
 * inputs. Pass the fields as children; they land in a padded, evenly-spaced body.
 */
interface SettingsCardProps {
  /** Small glyph shown in the tinted square at the left of the header. */
  icon?: React.ReactNode;
  title: string;
  /** One-line supporting text under the title. */
  description?: React.ReactNode;
  /** Optional node pinned to the right of the header (e.g. a status pill). */
  action?: React.ReactNode;
  className?: string;
  /** Extra classes for the body wrapper (e.g. to drop the default vertical rhythm). */
  bodyClassName?: string;
  children: React.ReactNode;
}

export default function SettingsCard({
  icon,
  title,
  description,
  action,
  className,
  bodyClassName,
  children,
}: SettingsCardProps) {
  return (
    <section
      className={clsx(
        'overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-soft',
        className,
      )}
    >
      <header className="flex items-start gap-3 border-b border-border-subtle px-6 py-5 sm:px-7">
        {icon && (
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-green/12 text-brand-dark-green">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-ginto text-lg font-medium leading-tight text-text-primary">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={clsx('px-6 py-6 sm:px-7', bodyClassName ?? 'space-y-5')}>{children}</div>
    </section>
  );
}
