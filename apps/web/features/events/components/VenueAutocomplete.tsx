'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import type { EventLocation, PlaceSuggestion } from '@/lib/events/places';
import { MapPinIcon } from '@/features/shared/icons';

/**
 * The composer's venue field. Typing asks /api/places for venues; picking one
 * stores the address, the coordinates and the place id, which is what turns
 * the location on the event page into a link that opens a map at the spot.
 * When the deployment has no map key the field is a plain venue field and the
 * event page still opens a map by name.
 */
export function VenueAutocomplete({
  value,
  onChange,
  className,
}: {
  value: EventLocation;
  onChange: (next: EventLocation) => void;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [available, setAvailable] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One token per search, from the first keystroke to the pick, so the
  // lookups are billed as one session; a new token after each pick.
  const sessionToken = useRef<string>(newToken());
  const latest = useRef(0);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!available || q.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const seq = ++latest.current;
      try {
        const res = await fetchJson<{ available: boolean; suggestions: PlaceSuggestion[] }>(
          `/api/places?q=${encodeURIComponent(q)}&session=${sessionToken.current}`,
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

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const label = e.target.value;
    // A hand edit is a new place: drop the coordinates of the old one.
    onChange({ label });
    search(label);
  };

  const pick = async (s: PlaceSuggestion) => {
    setOpen(false);
    setSuggestions([]);
    onChange({ label: s.name, address: s.detail || undefined });
    const token = sessionToken.current;
    sessionToken.current = newToken();
    try {
      const res = await fetchJson<{ location: EventLocation }>(`/api/places/${encodeURIComponent(s.placeId)}?label=${encodeURIComponent(s.name)}&session=${token}`);
      if (res.location.label) onChange(res.location);
    } catch {
      // The suggestion's own text is already stored; the map link falls back to a search by name.
    }
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
        value={value.label || ''}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder="Venue or address…"
        aria-label="Venue or address"
        autoComplete="off"
        className={className}
      />
      {value.address && value.placeId && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
          <MapPinIcon className="w-3 h-3 flex-none" /> <span className="truncate">{value.address}</span>
        </p>
      )}
      {open && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border-default bg-surface-1 shadow-float">
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              onMouseDown={(e) => { e.preventDefault(); void pick(s); }}
              onMouseEnter={() => setHighlighted(i)}
              className="flex cursor-pointer flex-col px-3 py-2 text-sm transition-colors"
              style={{ background: i === highlighted ? 'var(--color-surface-2)' : 'transparent' }}
            >
              <span className="font-medium text-text-primary">{s.name}</span>
              {s.detail && <span className="text-xs text-text-muted">{s.detail}</span>}
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
