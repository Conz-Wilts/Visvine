import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, ReactElement, ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  inputBaseClass,
  SEARCH_MENU_PANEL,
  SEARCH_MENU_ROW,
  SearchMenuEmpty,
  SearchMenuInput,
  SearchMenuList,
  searchMenuRowState,
  useSearchMenuCursor,
} from '@visvine/ui';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  /** Convenience for the common case; `<option>` children still work. */
  options?: SelectOption[];
  children?: ReactNode;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  /** Called like a native select's: `e.target.value` is the chosen value. */
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  /** The chosen value alone — the simpler form of `onChange`. */
  onValueChange?: (value: string) => void;
  placeholder?: string;
  /** `sm` is a toolbar's height (36px), beside a search and a view switch. */
  size?: 'sm' | 'md';
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/** Past this many options the menu opens with a search field across its top. */
const SEARCH_AT = 8;
/** Room the menu wants below the trigger before it opens upward instead. */
const MENU_ROOM = 320;

function optionsFrom(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: unknown; children?: ReactNode; disabled?: boolean }>;
    if (el.type === 'option') {
      const label = Children.toArray(el.props.children).join('');
      out.push({ value: String(el.props.value ?? label), label, disabled: el.props.disabled });
    } else if (el.props.children) {
      out.push(...optionsFrom(el.props.children));
    }
  });
  return out;
}

/**
 * The app's own dropdown: a field-shaped trigger and the floating menu every
 * list in the app opens (@visvine/ui's SearchMenu) — never the system's
 * native popup. Controlled or not, called like a native select, so a Tool
 * written against `<select>` keeps working.
 */
export function Select({
  options,
  children,
  value,
  defaultValue,
  onChange,
  onValueChange,
  placeholder = 'Choose…',
  size = 'md',
  disabled,
  required,
  id,
  name,
  className,
  style,
  ...aria
}: SelectProps) {
  const list = options ?? optionsFrom(children);
  const [inner, setInner] = useState(defaultValue === undefined ? '' : String(defaultValue));
  const current = value === undefined ? inner : String(value);
  const chosen = list.find((o) => o.value === current);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [upward, setUpward] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const searchable = list.length > SEARCH_AT;
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((o) => o.label.toLowerCase().includes(q)) : list;

  const close = () => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };
  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    if (value === undefined) setInner(option.value);
    onValueChange?.(option.value);
    if (onChange) {
      const target = { value: option.value, name: name ?? '', id: id ?? '' } as HTMLSelectElement;
      onChange({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
    }
    close();
  };
  const cursor = useSearchMenuCursor({
    count: shown.length,
    resetKey: query,
    onChoose: (i) => shown[i] && choose(shown[i]),
    onClose: close,
  });

  // Open where there is room: the frame is only as tall as the pane.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setUpward(window.innerHeight - rect.bottom < MENU_ROOM && rect.top > window.innerHeight - rect.bottom);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    const at = list.findIndex((o) => o.value === current);
    setOpen(true);
    if (at >= 0) cursor.setActive(at);
  };

  return (
    <div ref={rootRef} className={clsx('relative', className)} style={style}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-required={required}
        disabled={disabled}
        {...aria}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openMenu();
          } else if (open && !searchable) {
            cursor.onKeyDown(e);
          }
        }}
        className={clsx(inputBaseClass, 'flex items-center gap-2 pr-10 text-left', size === 'sm' && 'h-9 py-0 pl-3 text-sm')}
      >
        <span className={clsx('min-w-0 flex-1 truncate', !chosen && 'text-fg-muted')}>{chosen ? chosen.label : placeholder}</span>
      </button>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={clsx('pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted transition-transform', open && 'rotate-180')}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
      {name && <input type="hidden" name={name} value={current} />}
      {open && (
        <div className={clsx(SEARCH_MENU_PANEL, 'absolute inset-x-0', upward ? 'bottom-full mb-1' : 'top-full mt-1')}>
          {searchable && (
            <SearchMenuInput value={query} onChange={setQuery} onKeyDown={cursor.onKeyDown} placeholder="Search" />
          )}
          <SearchMenuList active={cursor.active}>
            <div id={listId} role="listbox">
              {shown.length === 0 && <SearchMenuEmpty />}
              {shown.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === current}
                  data-menu-row={i}
                  disabled={o.disabled}
                  onMouseEnter={() => cursor.setActive(i)}
                  onClick={() => choose(o)}
                  className={clsx(
                    SEARCH_MENU_ROW,
                    searchMenuRowState(i === cursor.active),
                    o.value === current ? 'font-medium text-fg' : 'text-fg-secondary',
                    o.disabled && 'opacity-50',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.value === current && (
                    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 text-accent">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </SearchMenuList>
        </div>
      )}
    </div>
  );
}
