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
  error: 'border-danger-bright text-danger-strong',
  info: 'border-info-bright text-info',
  warning: 'border-warning-bright text-warning',
  success: 'border-success text-success',
};

const DISMISS_CLASSES: Record<AlertVariant, string> = {
  error: 'text-danger hover:text-danger-strong',
  info: 'text-info hover:text-info-strong',
  warning: 'text-warning hover:text-warning-strong',
  success: 'text-success hover:text-success-strong',
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
