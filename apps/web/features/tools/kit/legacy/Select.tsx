import type { ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from './cx';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Convenience for the common case; pass `<option>` children for anything else. */
  options?: SelectOption[];
  children?: ReactNode;
}

export function Select({ options, className, children, ...rest }: SelectProps) {
  return (
    <select {...rest} className={cx('vv-select', className)}>
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );
}
