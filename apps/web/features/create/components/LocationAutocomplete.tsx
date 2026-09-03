'use client';

import { useEffect, useRef, useState } from 'react';
import { searchLocations } from '@/lib/locationData';

const inputClass =
  'w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted ' +
  'transition-colors focus:bg-surface-1 focus:outline-none focus:ring-1 focus:ring-border-default';

/**
 * A city picker over the bundled location list: type, arrow through the
 * matches, Enter to take one. Shared by the Create panel's rows and the note
 * surface's Location property row, so there is one implementation.
 */
export function LocationAutocomplete({
  value,
  onChange,
  placeholder = 'Location',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    const results = searchLocations(v);
    setSuggestions(results);
    setOpen(results.length > 0);
    setHighlighted(0);
  };

  const pick = (loc: string) => {
    onChange(loc);
    setOpen(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (suggestions[highlighted]) pick(suggestions[highlighted]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <input
        className={className ?? inputClass}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        autoComplete="off"
      />
      {open && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto overflow-hidden rounded-lg border border-border-default bg-surface-1 shadow-float">
          {suggestions.map((loc, i) => {
            const [city, country] = loc.includes(', ') ? loc.split(/, (.+)/) : [loc, ''];
            return (
              <li
                key={loc}
                onMouseDown={() => pick(loc)}
                className="flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm transition-colors"
                style={{ background: i === highlighted ? 'var(--color-surface-2)' : 'transparent' }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="font-medium text-text-primary">{city}</span>
                {country && <span className="text-xs text-text-muted">{country}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
