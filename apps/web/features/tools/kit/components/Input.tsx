import type { InputHTMLAttributes } from 'react';
import { Input as UIInput } from '@visvine/ui';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** The app's own text input (@visvine/ui). */
export function Input(props: InputProps) {
  return <UIInput {...props} />;
}
