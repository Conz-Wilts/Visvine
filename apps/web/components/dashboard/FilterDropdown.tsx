'use client';

import { useEffect, useRef, useState } from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';
import Dropdown, {
  DROPDOWN_TRIGGER_CLASS,
  DROPDOWN_TRIGGER_COMPACT_CLASS,
  DROPDOWN_MENU_CLASS,
  DROPDOWN_TRIGGER_ACTIVE_STYLE,
  DROPDOWN_TRIGGER_IDLE_STYLE,
} from '@/components/ui/Dropdown';

// ── Multi-select filter dropdown ──────────────────────────────────────────────
interface SubOption {
  value: string;
  label: string;
  count?: number;
  color?: string;
}

interface FilterDropdownProps {
  label: string;
  options: { value: string; label: string; count?: number; subOptions?: SubOption[] }[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  selectedSub?: Set<string>;
  onChangeSub?: (selected: Set<string>) => void;
  getColor?: (value: string) => string;
  singleSelect?: boolean;
  /** Toolbar sizing (h-10, rounded-xl) instead of the standing h-12 pill. */
  compact?: boolean;
}

export function FilterDropdown({ label, options, selected, onChange, selectedSub, onChangeSub, getColor, singleSelect, compact }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const isActive = selected.size > 0 || (selectedSub?.size ?? 0) > 0;

  const activeColor = selected.size === 1 && getColor && (selectedSub?.size ?? 0) === 0
    ? getColor([...selected][0])
    : null;

  useClickOutside(ref, () => { setOpen(false); setSearch(''); });

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
    else setSearch('');
  }, [open]);

  function toggle(value: string) {
    if (singleSelect) {
      // Radio behaviour: can't deselect — must always have one selected
      if (selected.has(value)) return;
      onChange(new Set([value]));
      setOpen(false);
      return;
    }
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  function toggleSub(value: string) {
    if (!onChangeSub || !selectedSub) return;
    const next = new Set(selectedSub);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChangeSub(next);
  }

  function toggleExpanded(value: string) {
    setExpandedSubs(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const filteredOptions = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  let triggerLabel: string;
  if (selected.size === 0 && (selectedSub?.size ?? 0) === 0) triggerLabel = 'All';
  else if (selected.size === 1 && (selectedSub?.size ?? 0) === 0) {
    const val = [...selected][0];
    triggerLabel = options.find(o => o.value === val)?.label ?? val;
  } else if (selected.size === 0 && (selectedSub?.size ?? 0) === 1) {
    const val = [...selectedSub!][0];
    const subLabel = options.flatMap(o => o.subOptions ?? []).find(s => s.value === val)?.label;
    triggerLabel = subLabel ?? val;
  }
  else {
    const total = selected.size + (selectedSub?.size ?? 0);
    triggerLabel = `${total} selected`;
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={compact ? DROPDOWN_TRIGGER_COMPACT_CLASS : DROPDOWN_TRIGGER_CLASS}
        style={
          isActive && activeColor
            ? { borderColor: activeColor, backgroundColor: `${activeColor}18`, color: activeColor }
            : isActive
            ? DROPDOWN_TRIGGER_ACTIVE_STYLE
            : DROPDOWN_TRIGGER_IDLE_STYLE
        }
      >
        <svg
          className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          style={{ opacity: 0.5 }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span style={{ opacity: 0.65 }}>{label}:</span>
        <span>{triggerLabel}</span>
      </button>

      {open && (
        <div className={`${DROPDOWN_MENU_CLASS} min-w-[200px]`}>
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex flex-1 min-w-0 items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
              <svg className="h-3 w-3 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                className="flex-1 min-w-0 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="text-text-muted hover:text-text-secondary transition-colors">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {isActive && !singleSelect && (
              <button
                type="button"
                onClick={() => { onChange(new Set()); onChangeSub?.(new Set()); }}
                className="shrink-0 text-[11px] text-brand-green font-semibold hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-[320px] overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar">
          {filteredOptions.length === 0 && (
            <p className="px-4 py-3 text-xs text-text-muted">No matches</p>
          )}

          {filteredOptions.map(opt => {
            const checked = selected.has(opt.value);
            const color = getColor ? getColor(opt.value) : 'var(--color-brand-green)';
            const hasSubs = opt.subOptions && opt.subOptions.length > 0;
            const subExpanded = expandedSubs.has(opt.value);

            return (
              <div key={opt.value}>
                <div className="flex items-center w-full">
                  {hasSubs && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(opt.value)}
                      className="flex items-center justify-center shrink-0 pl-4 pr-1 py-2.5 text-text-muted hover:text-text-secondary transition-colors"
                      title={subExpanded ? 'Hide aliases' : 'Show aliases'}
                    >
                      <svg
                        className={`h-3 w-3 transition-transform duration-150 ${subExpanded ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className="flex-1 flex items-center gap-3 py-2.5 text-sm text-text-secondary hover:bg-surface-2 transition-colors"
                    style={{ paddingLeft: hasSubs ? '0.5rem' : '1rem', paddingRight: '1rem' }}
                  >
                    <span className={`flex-1 text-left ${checked ? 'font-medium text-text-primary' : ''}`}>{opt.label}</span>
                    {opt.count !== undefined && (
                      <span className="text-xs text-text-muted tabular-nums">{opt.count}</span>
                    )}
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors"
                      style={checked
                        ? { backgroundColor: color, borderColor: color, border: `1.5px solid ${color}` }
                        : { border: '1.5px solid var(--border-default, #d1d5db)', backgroundColor: 'var(--surface-1, #fff)' }
                      }
                    >
                      {checked && (
                        <svg className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </button>
                </div>

                {hasSubs && subExpanded && (
                  <div className="ml-6 mr-2 mb-1">
                    {opt.subOptions!.map(sub => {
                      const subChecked = selectedSub?.has(sub.value) ?? false;
                      const subColor = sub.color ?? color;
                      return (
                        <button
                          key={sub.value}
                          type="button"
                          onClick={() => toggleSub(sub.value)}
                          className="w-full flex items-center gap-2.5 border-l-2 px-3 py-2 text-xs text-text-secondary hover:bg-surface-2 transition-colors"
                          style={{ borderColor: subColor }}
                        >
                          <span className={`flex-1 text-left ${subChecked ? 'font-medium text-text-primary' : ''}`}>{sub.label}</span>
                          {sub.count !== undefined && (
                            <span className="text-xs text-text-muted tabular-nums">{sub.count}</span>
                          )}
                          <span
                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded transition-colors"
                            style={subChecked
                              ? { backgroundColor: subColor, borderColor: subColor, border: `1.5px solid ${subColor}` }
                              : { border: '1.5px solid var(--border-default, #d1d5db)', backgroundColor: 'var(--surface-1, #fff)' }
                            }
                          >
                            {subChecked && (
                              <svg className="h-2 w-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sort dropdown ─────────────────────────────────────────────────────────────
interface SortDropdownProps {
  value: 'az' | 'za';
  onChange: (value: 'az' | 'za') => void;
  compact?: boolean;
}

const SORT_OPTIONS = [
  { value: 'az' as const, label: 'A → Z' },
  { value: 'za' as const, label: 'Z → A' },
];

export function SortDropdown({ value, onChange, compact }: SortDropdownProps) {
  return (
    <Dropdown
      label="Sort"
      value={value}
      options={SORT_OPTIONS}
      onChange={onChange}
      menuWidthClass="min-w-[140px]"
      compact={compact}
    />
  );
}
