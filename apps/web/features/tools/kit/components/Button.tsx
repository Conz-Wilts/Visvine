import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button as UIButton } from '@visvine/ui';

/** The kit's names for the app's button variants; the app's own names work too. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand' | 'neutral' | 'danger-text';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** Shows the app's spinner and disables the button. */
  loading?: boolean;
  loadingText?: string;
  children: ReactNode;
}

const VARIANT: Record<ButtonVariant, 'brand' | 'neutral' | 'ghost' | 'danger' | 'danger-text'> = {
  primary: 'brand',
  secondary: 'neutral',
  ghost: 'ghost',
  danger: 'danger',
  brand: 'brand',
  neutral: 'neutral',
  'danger-text': 'danger-text',
};

/**
 * The app's own button (@visvine/ui). Defaults to `secondary` and
 * `type="button"`: a Tool's buttons are usually actions inside a pane, and an
 * accidental form submit inside a sandboxed frame reloads the document out
 * from under the runtime.
 */
export function Button({ variant = 'secondary', size = 'md', type = 'button', ...rest }: ButtonProps) {
  return <UIButton type={type} variant={VARIANT[variant]} size={size} {...rest} />;
}
