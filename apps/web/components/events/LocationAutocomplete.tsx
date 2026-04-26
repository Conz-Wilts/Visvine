'use client';

/**
 * Google Places Autocomplete for event location
 * Requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in env
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MapPin, Loader2, X } from 'lucide-react';

interface LocationAutocompleteProps {
  value: string;
  onChange: (place: { label: string; address?: string; lat?: number; lon?: number }) => void;
  placeholder?: string;
  className?: string;
}

declare global {
  interface Window {
    google: typeof google;
    initGoogleMaps?: () => void;
  }
}

let mapsLoaded = false;
let mapsLoading = false;
const mapsCallbacks: Array<() => void> = [];

function loadGoogleMaps(apiKey: string): Promise<void> {
  return new Promise((resolve) => {
    if (mapsLoaded) { resolve(); return; }
    mapsCallbacks.push(resolve);
    if (mapsLoading) return;
    mapsLoading = true;

    window.initGoogleMaps = () => {
      mapsLoaded = true;
      mapsCallbacks.forEach(cb => cb());
      mapsCallbacks.length = 0;
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initGoogleMaps`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });
}

export function LocationAutocomplete({ value, onChange, placeholder = 'Search for a venue or address...', className = '' }: LocationAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setApiReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesService = useRef<google.maps.places.PlacesService | null>(null);
  const sessionToken = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!apiKey) return;
    loadGoogleMaps(apiKey).then(() => {
      autocompleteService.current = new window.google.maps.places.AutocompleteService();
      // PlacesService requires a DOM element
      const dummy = document.createElement('div');
      placesService.current = new window.google.maps.places.PlacesService(dummy);
      sessionToken.current = new window.google.maps.places.AutocompleteSessionToken();
      setApiReady(true);
    });
  }, [apiKey]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = useCallback((query: string) => {
    if (!autocompleteService.current || !query.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    autocompleteService.current.getPlacePredictions(
      {
        input: query,
        sessionToken: sessionToken.current || undefined,
        types: ['establishment', 'geocode'],
      },
      (predictions, status) => {
        setLoading(false);
        if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
          setSuggestions(predictions);
          setOpen(true);
        } else {
          setSuggestions([]);
          setOpen(false);
        }
      }
    );
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInputValue(v);
    setActiveIndex(-1);

    // Pass plain text value up immediately so the form stays in sync
    onChange({ label: v });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 250);
  };

  const selectPrediction = (prediction: google.maps.places.AutocompletePrediction) => {
    setOpen(false);
    setSuggestions([]);
    setInputValue(prediction.description);

    if (!placesService.current) {
      onChange({ label: prediction.description });
      return;
    }

    // Fetch place details for lat/lon
    placesService.current.getDetails(
      {
        placeId: prediction.place_id,
        fields: ['name', 'formatted_address', 'geometry'],
        sessionToken: sessionToken.current || undefined,
      },
      (place, status) => {
        // Refresh session token after a completed session
        sessionToken.current = new window.google.maps.places.AutocompleteSessionToken();

        if (status === window.google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
          onChange({
            label: place.name || prediction.structured_formatting.main_text,
            address: place.formatted_address,
            lat: place.geometry.location.lat(),
            lon: place.geometry.location.lng(),
          });
          setInputValue(place.name || prediction.structured_formatting.main_text);
        } else {
          onChange({ label: prediction.description });
        }
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectPrediction(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const clearInput = () => {
    setInputValue('');
    onChange({ label: '' });
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  // Fallback plain text input if no API key configured
  if (!apiKey) {
    return (
      <input
        type="text"
        value={value}
        onChange={e => onChange({ label: e.target.value })}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <MapPin className="absolute left-3 w-4 h-4 text-brand-grey pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className={`${className} pl-9 pr-9`}
        />
        {loading && <Loader2 className="absolute right-3 w-4 h-4 text-brand-grey animate-spin pointer-events-none" />}
        {!loading && inputValue && (
          <button type="button" onClick={clearInput} className="absolute right-3 p-0.5 text-brand-grey hover:text-brand-black rounded transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-surface-1 border border-border-subtle rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((s, idx) => (
            <li key={s.place_id}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); selectPrediction(s); }}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors ${idx === activeIndex ? 'bg-surface-2' : ''}`}
              >
                <MapPin className="w-4 h-4 text-brand-grey mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-brand-black truncate">
                    {s.structured_formatting.main_text}
                  </div>
                  <div className="text-xs text-brand-grey truncate">
                    {s.structured_formatting.secondary_text}
                  </div>
                </div>
              </button>
            </li>
          ))}
          <li className="px-4 py-2 border-t border-border-subtle">
            <span className="text-xs text-brand-grey">Powered by Google Maps</span>
          </li>
        </ul>
      )}
    </div>
  );
}
