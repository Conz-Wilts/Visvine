import { clsx } from 'clsx';

type ButtonVariant = 'ghost' | 'brand' | 'neutral' | 'danger' | 'danger-text';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // A quiet text action: no border, no fill at rest, a faint tint under the
  // pointer. Sits beside content without framing it.
  ghost: 'text-fg-secondary hover:bg-surface-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed',
  // The three action variants. Rounded squares, not pills: the only pill in the
  // app is the sidebar's nav indicator, so a button that reads as one anywhere
  // else is a mistake. They share a size (below) so any two of them sit side by
  // side in a dialog footer at the same height.
  //
  // All three are painted, none tinted, and none cast a shadow — a button
  // sits on the page, it doesn't float over it. `neutral` is the quiet half of a pair
  // (Cancel beside Delete, Deny beside Approve): it carries no colour at all
  // rather than a wash of the brand colour, which would both shout as loudly as
  // the action it sits next to and read as the tinted chip look we removed.
  brand: 'bg-accent text-white rounded-lg hover:opacity-90 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60',
  neutral: 'bg-surface-subtle text-fg-secondary rounded-lg hover:bg-surface-muted active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60',
  danger: 'bg-danger text-white rounded-lg hover:bg-danger-strong active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60',
  'danger-text': 'text-danger hover:text-danger-strong disabled:text-fg-muted',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded',
  md: 'px-4 py-2 text-sm rounded-lg',
};

export default function Button({
  variant = 'brand',
  size = 'md',
  loading = false,
  loadingText,
  children,
  disabled,
  className,
  ...props
}: ButtonProps) {
  // brand/soft/danger are one family and share a size, so a confirm dialog's
  // pair never comes out mismatched. `size` doesn't apply to them.
  const isAction = variant === 'brand' || variant === 'neutral' || variant === 'danger';
  const isDangerText = variant === 'danger-text';

  const sizeClass = isAction
    ? 'px-4 py-2.5 text-sm font-semibold transition-all duration-200'
    : isDangerText
      ? 'text-xs'
      : SIZE_CLASSES[size];

  return (
    <button
      disabled={disabled || loading}
      className={clsx(
        'font-medium transition-colors',
        VARIANT_CLASSES[variant],
        sizeClass,
        className,
      )}
      {...props}
    >
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
