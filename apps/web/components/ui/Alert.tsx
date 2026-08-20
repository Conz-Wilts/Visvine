import { clsx } from 'clsx';

type AlertVariant = 'error' | 'info' | 'warning' | 'success';

interface AlertProps {
  variant?: AlertVariant;
  children: React.ReactNode;
  onDismiss?: () => void;
  /** Use `inline` for a single compact line (e.g. inside modal footers) */
  inline?: boolean;
  className?: string;
}

// A notice is a line of text with a 2px rule in its colour down the left, not
// a tinted box: it sits in the flow of the page and says one thing. The rule
// carries the severity; the text carries the message.
const RULE_CLASSES: Record<AlertVariant, string> = {
  error: 'border-red-500 text-red-700',
  info: 'border-blue-500 text-blue-700',
  warning: 'border-amber-500 text-amber-700',
  success: 'border-green-600 text-green-700',
};

const DISMISS_CLASSES: Record<AlertVariant, string> = {
  error: 'text-red-600 hover:text-red-800',
  info: 'text-blue-600 hover:text-blue-800',
  warning: 'text-amber-600 hover:text-amber-800',
  success: 'text-green-600 hover:text-green-800',
};

export default function Alert({ variant = 'error', children, onDismiss, inline = false, className }: AlertProps) {
  if (inline) {
    return (
      <div className={clsx('border-l-2 pl-3 py-0.5 text-sm', RULE_CLASSES[variant], className)}>
        {children}
      </div>
    );
  }

  return (
    <div className={clsx('border-l-2 pl-4 py-1', RULE_CLASSES[variant], className)}>
      <p className="text-sm">{children}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={clsx('mt-1.5 text-xs underline', DISMISS_CLASSES[variant])}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
