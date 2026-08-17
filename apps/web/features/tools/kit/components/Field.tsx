import type { ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

/** Label + control + one line of help. `error` replaces `hint` when set. */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="vv-field">
      <label className="vv-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className="vv-field__error">{error}</span> : hint ? <span className="vv-field__hint">{hint}</span> : null}
    </div>
  );
}
