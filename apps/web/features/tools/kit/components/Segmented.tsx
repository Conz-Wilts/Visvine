import { clsx } from 'clsx';

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  /** The chosen value; null when nothing is chosen yet. */
  value: string | null;
  onChange: (value: string) => void;
  /** Names the choice for a screen reader. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A row of joined buttons, one of which is on — a vote on a scale, a view
 * switch, a filter of two to five values the viewer should see all at once.
 */
export function Segmented({ options, value, onChange, label, disabled, className }: SegmentedProps) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('inline-flex rounded-lg border border-line-subtle bg-surface p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={clsx(
              'h-8 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-50',
              on ? 'bg-accent-strong text-fg-inverse' : 'text-fg-secondary hover:bg-surface-subtle hover:text-fg',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
