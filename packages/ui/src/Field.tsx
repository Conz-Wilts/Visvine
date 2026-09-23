'use client';

import { clsx } from 'clsx';

/**
 * Labelled form-field wrapper. Standardizes the label weight/spacing and the
 * optional hint/error rhythm used across the settings forms so every field lines
 * up the same way. Pass the control (`Input`, `Textarea`, `Select`, a custom
 * picker, …) as children.
 */
interface FieldProps {
  label: React.ReactNode;
  /** Muted helper text shown below the control. */
  hint?: React.ReactNode;
  /** Error text shown below the control; takes visual priority over `hint`. */
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export default function Field({ label, hint, error, className, children }: FieldProps) {
  return (
    <div className={clsx('w-full', className)}>
      <label className="mb-1.5 block text-base font-medium text-fg">{label}</label>
      {children}
      {error ? (
        <p className="mt-1 text-sm text-danger-bright">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-sm text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}
