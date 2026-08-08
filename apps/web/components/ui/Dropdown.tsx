'use client';

import { useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';

// Shared dropdown sizing — import these when building a custom dropdown
// (multi-select, search, etc.) so trigger/menu/items stay in sync site-wide.
export const DROPDOWN_TRIGGER_CLASS =
  'flex h-12 lg:h-10 items-center gap-2 rounded-2xl border px-4 text-sm lg:text-[13px] font-semibold shadow-sm transition-colors';
/** Toolbar-sized trigger — sits on one line beside a 40px search field. */
export const DROPDOWN_TRIGGER_COMPACT_CLASS =
  'flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition-colors';
export const DROPDOWN_MENU_CLASS =
  'absolute left-0 top-full mt-2 z-50 rounded-2xl border border-border-subtle bg-surface-1 shadow-xl py-1.5 overflow-hidden';
const DROPDOWN_ITEM_CLASS =
  'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2';

export const DROPDOWN_TRIGGER_ACTIVE_STYLE: React.CSSProperties = {
  borderColor: 'var(--color-brand-green)',
  backgroundColor: 'var(--color-brand-light-bg)',
  color: 'var(--color-brand-dark-green)',
};
export const DROPDOWN_TRIGGER_IDLE_STYLE: React.CSSProperties = {
  borderColor: 'var(--border-default, #e5e7eb)',
  backgroundColor: 'var(--surface-1, #fff)',
  color: 'var(--text-secondary, #374151)',
};

interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
}

interface DropdownProps<T extends string> {
  /** Prefix shown inside the trigger, e.g. "Time:". */
  label?: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Green "filter applied" trigger state. */
  active?: boolean;
  menuWidthClass?: string;
  className?: string;
  /** Toolbar sizing (h-10, rounded-xl) instead of the standing h-12 pill. */
  compact?: boolean;
}

/**
 * Standard single-select dropdown — one size everywhere
 * (h-12 rounded-2xl trigger, rounded-2xl menu with px-4 py-2.5 items).
 */
export default function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  active = false,
  menuWidthClass = 'min-w-[160px]',
  className,
  compact = false,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, () => setOpen(false));

  const activeLabel = options.find(o => o.value === value)?.label ?? '';

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={compact ? DROPDOWN_TRIGGER_COMPACT_CLASS : DROPDOWN_TRIGGER_CLASS}
        style={active ? DROPDOWN_TRIGGER_ACTIVE_STYLE : DROPDOWN_TRIGGER_IDLE_STYLE}
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          style={{ opacity: 0.5 }}
        />
        {label && <span style={{ opacity: 0.65 }}>{label}:</span>}
        <span>{activeLabel}</span>
      </button>

      {open && (
        <div className={`${DROPDOWN_MENU_CLASS} ${menuWidthClass}`}>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={DROPDOWN_ITEM_CLASS}
            >
              <span className={value === opt.value ? 'font-medium text-text-primary' : 'text-text-secondary'}>
                {opt.label}
              </span>
              {value === opt.value && <Check className="h-4 w-4 shrink-0 text-brand-green" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
