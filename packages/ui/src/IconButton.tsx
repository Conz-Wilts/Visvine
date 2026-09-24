import { clsx } from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { FOCUS_RING } from './focus';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The action's name — the accessible label and the hover title. */
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md';
  /** Pressed: a toggle that is on, a menu that is open. */
  active?: boolean;
}

const SIZE = {
  sm: 'h-7 w-7 rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5',
  md: 'h-8 w-8 rounded-lg [&>svg]:h-4 [&>svg]:w-4',
} as const;

/**
 * A square, quiet button that is only an icon: the label is its name for a
 * screen reader and its title under the pointer, never text on the page.
 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'md', active = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        active && 'bg-surface-muted text-fg',
        SIZE[size],
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});

export default IconButton;
