'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface StripOption {
  value: string;
  label: string;
  count?: number;
  icon?: ReactNode;
}

/**
 * A row of words to narrow by — the Directory's TypeStrip at Discover's
 * scale. Either a radio (`value` is one string) or a set (`value` is a Set):
 * the same look, so "When" and "Sector" read as one control family.
 */
export default function FilterStrip({
  label,
  options,
  value,
  onChange,
  showLabel = false,
}: {
  label: string;
  /** Say the word before the options, when the options alone would not. */
  showLabel?: boolean;
  options: StripOption[];
  value: string | ReadonlySet<string>;
  onChange: (next: string | Set<string>) => void;
}) {
  const isSet = typeof value !== 'string';
  const active = (v: string) => (isSet ? (value as ReadonlySet<string>).has(v) : value === v);

  const press = (v: string) => {
    if (!isSet) { onChange(v); return; }
    const next = new Set(value as ReadonlySet<string>);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next);
  };

  return (
    <div role={isSet ? 'group' : 'radiogroup'} aria-label={label} className="flex flex-wrap items-center gap-1">
      {showLabel && <span className="pr-1.5 text-[13px] font-semibold text-text-primary">{label}:</span>}
      {options.map((o) => {
        const on = active(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role={isSet ? 'checkbox' : 'radio'}
            aria-checked={on}
            onClick={() => press(o.value)}
            className={clsx(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
              on ? 'bg-surface-2 text-text-primary ring-1 ring-border-subtle' : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
            )}
          >
            {o.icon}
            <span>{o.label}</span>
            {o.count !== undefined && (
              <span className={clsx('shrink-0 text-[11px] tabular-nums', on ? 'text-text-secondary' : 'text-text-muted')}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
