'use client';

import { useState, useRef, useEffect } from 'react';
import { Community } from '@/lib/types';
import { COUNTRIES, countryCodeToFlag, getCountry } from '@/lib/countries';
import Button from '@/components/ui/Button';
import CommunityImageUpload from '@/components/community/CommunityImageUpload';

interface Props {
  community: Community;
  onSaved: (updated: Partial<Community>) => void;
}

// ─── Country Selector ─────────────────────────────────────────────────────────

function CountrySelector({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? COUNTRIES.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : COUNTRIES;

  const selected = value ? getCountry(value) : null;

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const handleOpen = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-1 text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center gap-2 text-left"
      >
        {selected ? (
          <>
            <span className="text-xl leading-none">{countryCodeToFlag(selected.code)}</span>
            <span className="flex-1">{selected.name}</span>
            <span
              onClick={handleClear}
              className="text-text-muted hover:text-text-primary ml-auto cursor-pointer text-xs px-1"
              title="Clear"
            >
              ✕
            </span>
          </>
        ) : (
          <span className="text-text-muted flex-1">Select a country…</span>
        )}
        <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-surface-1 border border-border-subtle rounded-xl shadow-xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border-subtle">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search countries…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border-default rounded-lg bg-surface-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* List */}
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-muted">No countries found</li>
            ) : (
              filtered.map(country => (
                <li key={country.code}>
                  <button
                    type="button"
                    onClick={() => handleSelect(country.code)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-surface-2 transition-colors ${
                      value === country.code ? 'bg-surface-2 font-medium' : ''
                    }`}
                  >
                    <span className="text-lg leading-none w-6 text-center">{countryCodeToFlag(country.code)}</span>
                    <span className="text-text-primary">{country.name}</span>
                    {value === country.code && (
                      <svg className="w-4 h-4 text-brand-green ml-auto shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function CommunitySettingsPanel({ community, onSaved }: Props) {
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description);
  const [country, setCountry] = useState(community.country ?? '');
  const [location, setLocation] = useState(community.location ?? '');
  const [tagsInput, setTagsInput] = useState((community.tags ?? []).join(', '));
  const [imageUrl, setImageUrl] = useState(community.imageUrl ?? '');
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    community.visibility === 'private' ? 'private' : 'public'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);

      const res = await fetch(`/api/communities/${community.id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description, country: country || null, location, tags, visibility }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return; }
      setSuccess(true);
      onSaved(data.community);
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="w-full space-y-5">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Community Image</label>
        <div className="flex justify-start">
          <CommunityImageUpload
            community={{ ...community, imageUrl }}
            onUploadComplete={url => {
              setImageUrl(url);
              onSaved({ imageUrl: url });
            }}
            size="lg"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Community Name</label>
        <input
          type="text"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-1 text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Description</label>
        <textarea
          rows={3}
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-1 text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Country</label>
        <CountrySelector value={country} onChange={setCountry} />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Location</label>
        <input
          type="text"
          value={location}
          onChange={e => setLocation(e.target.value)}
          placeholder="e.g. Auckland, New Zealand"
          className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-1 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Tags</label>
        <input
          type="text"
          value={tagsInput}
          onChange={e => setTagsInput(e.target.value)}
          placeholder="tech, startup, community (comma-separated)"
          className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-1 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-text-muted">Separate tags with commas</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Visibility</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'public', title: 'Public', desc: 'Discoverable & self-joinable' },
            { value: 'private', title: 'Private', desc: 'Invite link or admin add only' },
          ] as const).map(opt => {
            const active = visibility === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setVisibility(opt.value)}
                className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-all ${
                  active
                    ? 'border-brand-green bg-brand-green/10'
                    : 'border-border-default hover:border-brand-green/60'
                }`}
              >
                <span className="text-sm font-medium text-text-primary">{opt.title}</span>
                <span className="text-xs text-text-muted">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">Settings saved successfully.</p>}

      <Button type="submit" variant="pill-primary" loading={saving} loadingText="Saving…">
        Save Changes
      </Button>
    </form>
  );
}
