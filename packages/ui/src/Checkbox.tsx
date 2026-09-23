'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { FOCUS_RING } from './focus';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Rendered to the right of the box; clicking it toggles too. */
  label?: ReactNode;
  /** Some but not all of a set: drawn as a dash, reported as `mixed`. */
  indeterminate?: boolean;
  disabled?: boolean;
  /** The value is refused: the box and label take the danger colour. */
  invalid?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

const BOX: Record<NonNullable<CheckboxProps['size']>, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

/**
 * The platform's own checkbox, painted in the accent (`accent-color`), so it is
 * the control every browser and screen reader already knows. Use it for a
 * choice that joins a set; a setting that switches something on is a Toggle.
 */
export default function Checkbox({
  checked,
  onChange,
  label,
  indeterminate = false,
  disabled = false,
  invalid = false,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const box = (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.checked)}
      className={clsx(
        BOX[size],
        'shrink-0 rounded accent-accent disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'accent-danger outline outline-1 outline-danger-bright',
        FOCUS_RING,
        !label && className,
      )}
    />
  );

  if (!label) return box;

  return (
    <label
      className={clsx(
        'inline-flex items-center gap-2 text-sm',
        invalid ? 'text-danger' : 'text-fg-secondary',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      {box}
      <span>{label}</span>
    </label>
  );
}
