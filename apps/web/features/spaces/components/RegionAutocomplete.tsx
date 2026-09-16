'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import type { RegionSuggestion } from '@/lib/events/places';
import { MapPinIcon } from '@/features/shared/icons';

/**
 * A space's Location: a country, region or city, never an address. Typing
 * asks /api/places/regions; picking one stores its name and the ISO country
 * it sits in, which is what Discover files the space under. Without a map key
 * the field is plain text and the server reads the country out of the words.
 */
export default function RegionAutocomplete({
  value,
  onType,
  onPick,
  onBlur,
  className,
}: {
  value: string;
  /** A hand edit — the text alone. */
  onType: (label: string) => void;
  /** A picked region — its name and, when Google knows it, its country. */
  onPick: (label: string, country: string | null) => void;
  onBlur?: () => void;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<RegionSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [available, setAvailable] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One token from the first keystroke to the pick, so Google bills the
  // search as one session.
  const sessionToken = useRef<string>(newToken());
  const latest = useRef(0);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!available || q.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const seq = ++latest.current;
      try {
        const res = await fetchJson<{ available: boolean; suggestions: RegionSuggestion[] }>(
          `/api/places/regions?q=${encodeURIComponent(q)}&session=${sessionToken.current}`,
        );
        if (seq !== latest.current) return;
        if (!res.available) { setAvailable(false); return; }
        setSuggestions(res.suggestions);
        setOpen(res.suggestions.length > 0);
        setHighlighted(0);
      } catch {
        if (seq === latest.current) setOpen(false);
      }
    }, 250);
  };

  const pick = async (s: RegionSuggestion) => {
    if (timer.current) clearTimeout(timer.current);
    latest.current++;
    setOpen(false);
    setSuggestions([]);
    const token = sessionToken.current;
    sessionToken.current = newToken();
    let country: string | null = null;
    try {
      const res = await fetchJson<{ country: string | null }>(
        `/api/places/regions/${encodeURIComponent(s.placeId)}?session=${token}`,
      );
      country = res.country;
    } catch {
      // The name still saves; the server reads a country out of it.
    }
    onPick(s.label, country);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (suggestions[highlighted]) void pick(suggestions[highlighted]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onType(e.target.value); search(e.target.value); }}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        onBlur={onBlur}
        placeholder="City, region or country"
        aria-label="Location"
        autoComplete="off"
        className={className}
      />
      {open && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border-default bg-surface-1 shadow-float">
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              onMouseDown={(e) => { e.preventDefault(); void pick(s); }}
              onMouseEnter={() => setHighlighted(i)}
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors"
              style={{ background: i === highlighted ? 'var(--color-surface-2)' : 'transparent' }}
            >
              <MapPinIcon className="h-3.5 w-3.5 flex-none text-text-muted" />
              <span className="min-w-0 truncate">
                <span className="font-medium text-text-primary">{s.name}</span>
                {s.detail && <span className="text-text-muted">, {s.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function newToken(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}
