'use client';

import { clsx } from 'clsx';

/**
 * Label-left / control-right settings row (the Toggle-row pattern used across
 * the console's Features and Appearance sections). Stack several inside a
 * `SettingsCard` with `bodyClassName="divide-y divide-border-subtle space-y-0"`
 * for the classic divided-list rhythm.
 */
interface SettingRowProps {
  title: React.ReactNode;
  /** Muted supporting text under the title. */
  description?: React.ReactNode;
  /** The control (Toggle, Select, Button, …) pinned to the right. */
  control?: React.ReactNode;
  /** Optional extra content rendered full-width below the row (e.g. sub-settings). */
  children?: React.ReactNode;
  className?: string;
}

export default function SettingRow({ title, description, control, children, className }: SettingRowProps) {
  return (
    <div className={clsx('py-4 first:pt-0 last:pb-0', className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-base font-medium text-text-primary">{title}</div>
          {description && <div className="mt-0.5 text-sm text-text-muted">{description}</div>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
