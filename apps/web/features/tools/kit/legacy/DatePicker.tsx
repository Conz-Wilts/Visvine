/**
 * `DatePicker` — the browser's own `<input type="date">`, styled like the
 * kit's inputs. Values are ISO calendar dates (`YYYY-MM-DD`) or null, never a
 * `Date`: a Tool almost always stores the string into a note's frontmatter, and
 * a `Date` would drag a timezone into a field that has none.
 */
import type { InputHTMLAttributes } from 'react';
import { cx } from './cx';

export interface DatePickerProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> {
  /** `YYYY-MM-DD`, or null for empty. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** `YYYY-MM-DD` bounds. */
  min?: string;
  max?: string;
}

export function DatePicker({ value, onChange, min, max, className, ...rest }: DatePickerProps) {
  return (
    <input
      {...rest}
      type="date"
      className={cx('vv-input', 'vv-datepicker', className)}
      value={value ?? ''}
      min={min}
      max={max}
      onChange={(e) => onChange(e.currentTarget.value === '' ? null : e.currentTarget.value)}
    />
  );
}
