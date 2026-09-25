import type { ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}

/**
 * The app's labelled field (@visvine/ui's Field, with `htmlFor` for the
 * control it names): label, control, one line under it. `error` replaces
 * `hint`.
 */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="w-full">
      <label htmlFor={htmlFor} className="mb-1.5 block text-base font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-sm text-danger-bright">{error}</p> : hint ? <p className="mt-1 text-sm text-fg-muted">{hint}</p> : null}
    </div>
  );
}
