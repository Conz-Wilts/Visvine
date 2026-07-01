'use client';

import { useState, useEffect, useRef } from 'react';
import type { CreateableType } from '@/lib/contexts/CreateModalContext';
import type { CommunityAlias } from '@/lib/types';
import { validateImageFile } from '@/lib/imageUpload';
import { searchLocations } from '@/lib/locationData';

// ─── Type Config ────────────────────────────────────────────────────────────

export interface TypeOption {
  id: CreateableType;
  label: string;
  description: string;
  color: string;
  icon: React.ReactNode;
  inGrid?: boolean; // shown in the "Create new" type grid. Community lives in the
                    // registry (for title/label lookups) but is created from the
                    // community dropdown, so it's excluded from the grid.
}

export const TYPE_OPTIONS: TypeOption[] = [
  {
    id: 'person',
    label: 'Person',
    description: 'A person in your network',
    color: '#2563eb',
    inGrid: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: 'resource',
    label: 'Resource',
    description: 'A link, document, or asset',
    color: '#f59e0b',
    inGrid: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
  },
  {
    id: 'event',
    label: 'Event',
    description: 'A meetup, conference, or gathering',
    color: '#9333ea',
    inGrid: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'context',
    label: 'Context',
    description: 'A note in your community brain',
    color: '#0ea5e9',
    inGrid: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'community',
    label: 'Community',
    description: 'A new community workspace',
    color: '#78d870',
    inGrid: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
];

// ─── Shared styles ──────────────────────────────────────────────────────────

export const inputClass =
  'w-full px-3 py-2 rounded-lg border border-border-default bg-surface-2 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green transition-all';

// ─── Field Components ───────────────────────────────────────────────────────

export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-secondary">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Type Selector ──────────────────────────────────────────────────────────

export function TypeSelector({
  options,
  selected,
  onSelect,
}: {
  options: TypeOption[];
  selected: CreateableType | null;
  onSelect: (t: CreateableType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((opt) => {
        const active = selected === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onSelect(opt.id)}
            className="aspect-square flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 text-center overflow-hidden transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              borderColor: opt.color,
              background: active ? `${opt.color}18` : `${opt.color}08`,
              boxShadow: active ? `0 0 0 3px ${opt.color}35` : 'none',
            }}
          >
            <span style={{ color: opt.color }}>{opt.icon}</span>
            <span className="font-semibold text-sm text-text-primary">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Person Form ────────────────────────────────────────────────────────────

export interface PersonFormData {
  name: string;
  email: string;
  subtitle: string;
  location: string;
  tags: string;
  imageBlob: Blob | null;
  imagePreview: string | null;
}

// ─── Location Autocomplete ──────────────────────────────────────────────────

export function LocationAutocomplete({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
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
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
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
        className={inputClass}
        placeholder="e.g. San Francisco, United States"
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        autoComplete="off"
      />
      {open && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-1 border border-border-default rounded-lg shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {suggestions.map((loc, i) => {
            const [city, country] = loc.includes(', ') ? loc.split(/, (.+)/) : [loc, ''];
            return (
              <li
                key={loc}
                onMouseDown={() => pick(loc)}
                className="flex items-baseline gap-2 px-3 py-2 cursor-pointer text-sm transition-colors"
                style={{ background: i === highlighted ? 'var(--color-surface-2)' : 'transparent' }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="font-medium text-text-primary">{city}</span>
                {country && <span className="text-text-muted text-xs">{country}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Person Form ────────────────────────────────────────────────────────────

export function PersonForm({
  data,
  onChange,
  nameRef,
  onCropRequest,
}: {
  data: PersonFormData;
  onChange: (d: PersonFormData) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  onCropRequest: (file: File) => void;
}) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) return;
    onCropRequest(file);
    e.target.value = '';
  };

  const clearImage = () => {
    if (data.imagePreview) URL.revokeObjectURL(data.imagePreview);
    onChange({ ...data, imageBlob: null, imagePreview: null });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2">
        <label className="relative cursor-pointer group">
          {data.imagePreview ? (
            <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-border-default">
              <img src={data.imagePreview} alt="preview" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            </div>
          ) : (
            <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-border-default hover:border-brand-green flex flex-col items-center justify-center gap-1.5 text-text-muted hover:text-brand-green transition-colors bg-surface-2">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-[11px] font-medium">Add photo</span>
            </div>
          )}
          <input type="file" accept="image/*" className="sr-only" onChange={handleFileChange} />
        </label>
        {data.imagePreview && (
          <button type="button" onClick={clearImage} className="text-xs text-text-muted hover:text-red-500 transition-colors">
            Remove photo
          </button>
        )}
      </div>

      <Field label="Full Name" required>
        <input
          ref={nameRef as React.RefObject<HTMLInputElement>}
          className={inputClass}
          placeholder="e.g. Alex Johnson"
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
        />
      </Field>
      <Field label="Email">
        <input
          className={inputClass}
          type="email"
          placeholder="e.g. alex@example.com"
          value={data.email}
          onChange={(e) => onChange({ ...data, email: e.target.value })}
        />
      </Field>
      <Field label="Role / Subtitle">
        <input
          className={inputClass}
          placeholder="e.g. Founder at Acme"
          value={data.subtitle}
          onChange={(e) => onChange({ ...data, subtitle: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Location">
          <LocationAutocomplete value={data.location} onChange={(v) => onChange({ ...data, location: v })} />
        </Field>
        <Field label="Tags">
          <input
            className={inputClass}
            placeholder="design, ai, web3"
            value={data.tags}
            onChange={(e) => onChange({ ...data, tags: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

// ─── Event Form ─────────────────────────────────────────────────────────────

export interface EventFormData {
  name: string;
  subtitle: string;
  location: string;
  tags: string;
}

export function EventForm({
  data,
  onChange,
  nameRef,
}: {
  data: EventFormData;
  onChange: (d: EventFormData) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Event Name" required>
        <input
          ref={nameRef as React.RefObject<HTMLInputElement>}
          className={inputClass}
          placeholder="e.g. Annual Summit 2026"
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
        />
      </Field>
      <Field label="Description">
        <input
          className={inputClass}
          placeholder="e.g. Our flagship community event"
          value={data.subtitle}
          onChange={(e) => onChange({ ...data, subtitle: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Location">
          <input
            className={inputClass}
            placeholder="e.g. San Francisco"
            value={data.location}
            onChange={(e) => onChange({ ...data, location: e.target.value })}
          />
        </Field>
        <Field label="Tags">
          <input
            className={inputClass}
            placeholder="summit, networking"
            value={data.tags}
            onChange={(e) => onChange({ ...data, tags: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

// ─── Community Form ─────────────────────────────────────────────────────────

export interface CommunityFormData {
  name: string;
  description: string;
  location: string;
  visibility: 'public' | 'private';
}

export function CommunityForm({
  data,
  onChange,
  nameRef,
}: {
  data: CommunityFormData;
  onChange: (d: CommunityFormData) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Community Name" required>
        <input
          ref={nameRef as React.RefObject<HTMLInputElement>}
          className={inputClass}
          placeholder="e.g. Web3 Builders"
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
        />
      </Field>
      <Field label="Description">
        <textarea
          className={`${inputClass} resize-none`}
          rows={3}
          placeholder="What's this community about?"
          value={data.description}
          onChange={(e) => onChange({ ...data, description: e.target.value })}
        />
      </Field>
      <Field label="Location">
        <input
          className={inputClass}
          placeholder="e.g. Global, Bay Area"
          value={data.location}
          onChange={(e) => onChange({ ...data, location: e.target.value })}
        />
      </Field>
      <Field label="Visibility">
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'public', title: 'Public', desc: 'Anyone can find & join from Discover' },
            { value: 'private', title: 'Private', desc: 'Hidden — join by invite link or admin add' },
          ] as const).map((opt) => {
            const active = data.visibility === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...data, visibility: opt.value })}
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
      </Field>
    </div>
  );
}

// ─── Alias Selector ─────────────────────────────────────────────────────────

export function AliasSelector({
  aliases,
  selected,
  onSelect,
}: {
  aliases: CommunityAlias[];
  selected: string | null;
  onSelect: (a: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        This community uses role aliases. Choose one or skip.
      </p>
      <div className="flex flex-wrap gap-2">
        {aliases.map((alias) => {
          const active = selected === alias.name;
          return (
            <button
              key={alias.name}
              onClick={() => onSelect(active ? null : alias.name)}
              className="px-3 py-1.5 rounded-full text-sm font-semibold border-2 transition-all duration-150"
              style={{
                borderColor: active ? alias.color : 'var(--color-border-default, #e5e7eb)',
                background: active ? alias.color : 'var(--color-surface-2)',
                color: active ? '#fff' : 'var(--text-secondary)',
                boxShadow: active ? `0 0 0 3px ${alias.color}40` : 'none',
              }}
            >
              {alias.name}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => onSelect(null)}
        className="text-xs text-text-muted underline underline-offset-2 self-start hover:text-text-secondary transition-colors"
      >
        Skip — just add as Person
      </button>
    </div>
  );
}

// ─── Success Screen ─────────────────────────────────────────────────────────

export function SuccessScreen({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
        style={{ background: 'color-mix(in srgb, var(--color-brand-green, #78d870) 20%, transparent)' }}
      >
        ✓
      </div>
      <div>
        <p className="font-semibold text-text-primary text-lg">{label} created</p>
        <p className="text-sm text-text-muted mt-1">All done!</p>
      </div>
      <button
        onClick={onClose}
        className="mt-2 px-6 py-2 rounded-full bg-brand-green text-white text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Done
      </button>
    </div>
  );
}
