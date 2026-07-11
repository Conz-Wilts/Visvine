import { clsx } from 'clsx';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'pill-primary' | 'pill-secondary' | 'pill-danger' | 'danger-text';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed',
  secondary: 'text-blue-600 border border-blue-600 hover:bg-blue-50',
  ghost: 'text-gray-600 border border-gray-200 hover:bg-gray-50',
  'pill-primary': 'bg-brand-green text-white rounded-full hover:opacity-90 active:translate-y-[1px] shadow-soft disabled:cursor-not-allowed disabled:opacity-60',
  'pill-secondary': 'bg-brand-light-bg text-brand-green rounded-full',
  'pill-danger': 'bg-red-600 text-white rounded-full hover:bg-red-700 active:translate-y-[1px] shadow-soft disabled:cursor-not-allowed disabled:opacity-60',
  'danger-text': 'text-red-600 hover:text-red-800 disabled:text-gray-400',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded',
  md: 'px-4 py-2 text-sm rounded-lg',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  children,
  disabled,
  className,
  ...props
}: ButtonProps) {
  const isPill = variant === 'pill-primary' || variant === 'pill-secondary' || variant === 'pill-danger';
  const isDangerText = variant === 'danger-text';

  const sizeClass = isPill
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
