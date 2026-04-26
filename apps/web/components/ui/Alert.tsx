import { clsx } from 'clsx';

type AlertVariant = 'error' | 'info' | 'warning' | 'success';

interface AlertProps {
  variant?: AlertVariant;
  children: React.ReactNode;
  onDismiss?: () => void;
  /** Use `inline` for compact inline alerts without a border (e.g. inside modal footers) */
  inline?: boolean;
  className?: string;
}

const BLOCK_CLASSES: Record<AlertVariant, string> = {
  error: 'bg-red-50 border border-red-200 text-red-700',
  info: 'bg-blue-50 border border-blue-200 text-blue-700',
  warning: 'bg-amber-50 border border-amber-200 text-amber-700',
  success: 'bg-green-50 border border-green-200 text-green-700',
};

const INLINE_CLASSES: Record<AlertVariant, string> = {
  error: 'bg-red-50 text-red-600',
  info: 'bg-blue-50 text-blue-600',
  warning: 'bg-amber-50 text-amber-600',
  success: 'bg-green-50 text-green-600',
};

const DISMISS_CLASSES: Record<AlertVariant, string> = {
  error: 'text-red-600 hover:text-red-800',
  info: 'text-blue-600 hover:text-blue-800',
  warning: 'text-amber-600 hover:text-amber-800',
  success: 'text-green-600 hover:text-green-800',
};

const AlertIcon = () => (
  <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

export default function Alert({ variant = 'error', children, onDismiss, inline = false, className }: AlertProps) {
  if (inline) {
    return (
      <div className={clsx('flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm', INLINE_CLASSES[variant], className)}>
        <AlertIcon />
        {children}
      </div>
    );
  }

  return (
    <div className={clsx('rounded-md p-3', BLOCK_CLASSES[variant], className)}>
      <p className="text-sm">{children}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={clsx('mt-2 text-xs underline', DISMISS_CLASSES[variant])}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
