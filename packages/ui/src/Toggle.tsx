'use client';

import { clsx } from 'clsx';
import { FOCUS_RING } from './focus';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Optional label rendered to the right of the switch. */
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * Standard toggle switch — one size everywhere (40×24px track, 16px thumb).
 * The on-colour is the accent, which follows the chosen hue.
 */
export default function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: ToggleProps) {
  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full transition-colors duration-200',
        FOCUS_RING,
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-surface-muted',
        !label && className,
      )}
    >
      <span
        className={clsx(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-1',
        )}
      />
    </button>
  );

  if (!label) return switchEl;

  return (
    <label className={clsx('flex items-center gap-3', disabled ? 'cursor-not-allowed' : 'cursor-pointer', className)}>
      {switchEl}
      <span className="text-sm text-fg-secondary">{label}</span>
    </label>
  );
}
