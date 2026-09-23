'use client';

import { useEffect, useRef, useState } from 'react';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import { DROPDOWN_TRIGGER_CLASS, DROPDOWN_TRIGGER_ACTIVE_STYLE, DROPDOWN_TRIGGER_IDLE_STYLE, Chip, SEARCH_MENU_PANEL, SearchMenuEmpty, SearchMenuInput, SearchMenuList } from '@visvine/ui';

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
}

export function FilterDropdown({ label, options, selected, onChange, selectedSub, onChangeSub, getColor, singleSelect }: FilterDropdownProps) {
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

  // Search reaches sub-options too: a term that only matches an alias keeps its
  // parent in the list, trimmed to the matching aliases and expanded, so nothing
  // findable is hidden behind a collapsed row.
  const query = search.trim().toLowerCase();
  type Filtered = (typeof options)[number] & { forceExpand?: boolean };
  const filteredOptions: Filtered[] = query
    ? options.flatMap(o => {
        if (o.label.toLowerCase().includes(query)) return [o];
        const subs = (o.subOptions ?? []).filter(s => s.label.toLowerCase().includes(query));
        return subs.length ? [{ ...o, subOptions: subs, forceExpand: true }] : [];
      })
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
        className={DROPDOWN_TRIGGER_CLASS}
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
         
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span>{label}:</span>
        <span>{triggerLabel}</span>
      </button>

      {open && (
        <div className={`${SEARCH_MENU_PANEL} absolute left-0 top-full mt-1.5 w-[268px]`}>
          <SearchMenuInput
            ref={searchRef}
            value={search}
            onChange={setSearch}
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
            placeholder={`Search ${label.toLowerCase()}…`}
            autoFocus={false}
            trailing={isActive && !singleSelect ? (
              <button
                type="button"
                onClick={() => { onChange(new Set()); onChangeSub?.(new Set()); }}
                className="shrink-0 text-[11px] text-accent font-semibold hover:underline"
              >
                Clear
              </button>
            ) : undefined}
          />

          <SearchMenuList>
          {filteredOptions.length === 0 && <SearchMenuEmpty />}

          {filteredOptions.map(opt => {
            const checked = selected.has(opt.value);
            const color = getColor ? getColor(opt.value) : 'var(--vv-color-accent)';
            const hasSubs = opt.subOptions && opt.subOptions.length > 0;
            const subExpanded = opt.forceExpand || expandedSubs.has(opt.value);

            return (
              <div key={opt.value}>
                <div className="flex items-center w-full">
                  {/* The chevron gutter is reserved on every row, so labels line
                      up whether or not the type carries aliases. */}
                  {!hasSubs && <span className="w-8 shrink-0" aria-hidden />}
                  {hasSubs && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(opt.value)}
                      className="flex items-center justify-center shrink-0 pl-4 pr-1 py-2.5 text-fg-muted hover:text-fg-secondary transition-colors"
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
                    className="flex-1 flex items-center gap-3 py-2.5 text-sm text-fg-secondary hover:bg-surface-subtle transition-colors"
                    style={{ paddingLeft: '0.5rem', paddingRight: '1rem' }}
                  >
                    {getColor ? (
                      <span className="flex min-w-0 flex-1 justify-start">
                        <Chip color={color}>{opt.label}</Chip>
                      </span>
                    ) : (
                      <span className={`flex-1 text-left ${checked ? 'font-medium text-fg' : ''}`}>{opt.label}</span>
                    )}
                    {opt.count !== undefined && (
                      <span className="text-xs text-fg-muted tabular-nums">{opt.count}</span>
                    )}
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors"
                      style={checked
                        ? { backgroundColor: color, borderColor: color, border: `1.5px solid ${color}` }
                        : { border: '1.5px solid var(--vv-color-line)', backgroundColor: 'var(--vv-color-surface)' }
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
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-fg-secondary hover:bg-surface-subtle transition-colors"
                        >
                          {getColor ? (
                            <span className="flex min-w-0 flex-1 justify-start">
                              <Chip color={subColor} size="xs">{sub.label}</Chip>
                            </span>
                          ) : (
                            <span className={`flex-1 text-left ${subChecked ? 'font-medium text-fg' : ''}`}>{sub.label}</span>
                          )}
                          {sub.count !== undefined && (
                            <span className="text-xs text-fg-muted tabular-nums">{sub.count}</span>
                          )}
                          <span
                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded transition-colors"
                            style={subChecked
                              ? { backgroundColor: subColor, borderColor: subColor, border: `1.5px solid ${subColor}` }
                              : { border: '1.5px solid var(--vv-color-line)', backgroundColor: 'var(--vv-color-surface)' }
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
          </SearchMenuList>
        </div>
      )}
    </div>
  );
}
