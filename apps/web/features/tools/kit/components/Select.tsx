import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Select as UISelect } from '@visvine/ui';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Convenience for the common case; pass `<option>` children for anything else. */
  options?: SelectOption[];
  children?: ReactNode;
}

/** The app's own select (@visvine/ui). */
export function Select({ options, children, ...rest }: SelectProps) {
  return (
    <UISelect {...rest}>
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        : children}
    </UISelect>
  );
}
