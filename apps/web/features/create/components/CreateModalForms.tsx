'use client';

import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Newspaper } from 'lucide-react';
import type { CreateableType } from '@/features/shared/contexts/CreateModalContext';
import type { CreateSuggestion } from '@/lib/create/suggestedType';
import type { CommunityAlias } from '@/lib/types';
import type { ChannelSpaceEntry, ChannelViewMode } from '@/lib/messages/types';
import { validateImageFile } from '@/lib/imageUpload';
import { slugify } from '@/lib/eventUtils';
import { searchLocations } from '@/lib/locationData';
import { ChannelIcon, EmojiIconPicker } from '@/features/messages/components/ChannelIcon';
import {
  MAX_SOURCE_BYTES,
  SOURCE_ACCEPT,
  SOURCE_EXTENSIONS_LABEL,
  sourceKindOf,
} from '@/lib/notes/shared/sourceTypes';
import { EntityNotePreview, FolderPicker, PathPreview, type FolderOption } from './ContextDestination';

// ─── Type Config ────────────────────────────────────────────────────────────

export interface TypeOption {
  id: CreateableType;
  label: string;
  description: string;
  color: string;
  icon: React.ReactNode;
  inGrid?: boolean; // shown in the "Create new" type grid. Person, Community,
                    // Resource and Context are false: they're context notes, so
                    // they're created on the note-first surface
                    // (/directory/new), not in this panel. Their entries stay
                    // for label/title lookups.
}

export const TYPE_OPTIONS: TypeOption[] = [
  {
    id: 'person',
    label: 'Person',
    description: 'A person in your network',
    color: '#2563eb',
    inGrid: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    // An organisation in the directory — a node and a note, not a community you
    // run. Starting one of those is on the community switcher.
    id: 'community',
    label: 'Community',
    description: 'A company, organisation or group',
    color: '#78d870',
    inGrid: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    id: 'resource',
    label: 'Resource',
    description: 'A link, document, or asset',
    color: '#f59e0b',
    inGrid: false,
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
    // Events are created on /events, which owns the date/time/RSVP fields this
    // form doesn't have. The entry stays for label/title lookups and for the
    // form branch reached with an explicit `event` default type.
    inGrid: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'channel',
    label: 'Channel',
    description: 'A feed channel in your community',
    color: '#e0685f',
    inGrid: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 3L8 21M16 3l-2 18M4 8h17M3 16h17" />
      </svg>
    ),
  },
  {
    id: 'space',
    label: 'Space',
    description: 'A group of channels in your community',
    color: '#0ea5e9',
    inGrid: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
    ),
  },
  {
    id: 'context',
    label: 'Context',
    description: 'A note in your community context',
    color: '#ec4899',
    inGrid: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6M9 16h4M8 4h8a2 2 0 012 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 012-2z" />
      </svg>
    ),
  },
  {
    // A folder, written as its index note — the two are the same thing
    // (lib/notes/shared/indexNote.ts). Note-first like Context, so this entry
    // exists for label/colour lookups; the form lives on /directory/new.
    id: 'index',
    label: 'Index',
    description: 'The home page for a group of notes',
    color: '#c026d3',
    inGrid: false,
    // A page listing what sits under it, not a folder tab: an index is a note
    // you read, and the glyph should say that.
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 5h16M4 5v14M8 10h9M8 14h9M8 18h6" />
      </svg>
    ),
  },
  {
    id: 'file',
    label: 'File',
    description: 'Upload a document into context',
    color: '#14b8a6',
    inGrid: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 16V6a2 2 0 012-2h4l4 4v8a2 2 0 01-2 2H9a2 2 0 01-2-2z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 4v4h4M5 10v8a4 4 0 004 4h6" />
      </svg>
    ),
  },
  {
    id: 'connector',
    label: 'Connector',
    description: 'A gateway to an external API or database',
    color: '#6366f1',
    inGrid: false,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 3v5M15 3v5M7 8h10v4a5 5 0 01-5 5 5 5 0 01-5-5V8zM12 17v4" />
      </svg>
    ),
  },
];

// ─── Shared styles ──────────────────────────────────────────────────────────

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-border-default bg-surface-2 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green transition-all';

// ─── Field Components ───────────────────────────────────────────────────────

function Field({
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

// ─── Type List ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">
      {children}
    </p>
  );
}

function TypeRow({
  opt,
  onSelect,
  reason,
  suggested: isSuggested,
}: {
  opt: TypeOption;
  onSelect: (t: CreateableType) => void;
  /** Pilled on the right of a suggested row — only the first one carries it, so
      a multi-type suggestion doesn't repeat "You're on Channels" per row. */
  reason?: string;
  /** Emphasise the row as route-suggested (implied by `reason`). */
  suggested?: boolean;
}) {
  const suggested = isSuggested || reason != null;
  return (
    <button
      onClick={() => onSelect(opt.id)}
      className={`w-full flex items-center gap-3 rounded-xl text-left transition-all duration-150 active:scale-[0.99] ${
        suggested
          ? 'p-3.5 border-2'
          : 'p-2.5 border border-border-subtle hover:bg-surface-2 hover:border-border-default'
      }`}
      style={
        suggested
          ? {
              borderColor: opt.color,
              background: `${opt.color}12`,
              boxShadow: `0 0 0 3px ${opt.color}25`,
            }
          : undefined
      }
    >
      <span
        className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center"
        style={{ background: `${opt.color}18`, color: opt.color }}
      >
        {opt.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-sm text-text-primary">{opt.label}</span>
        <span className="block text-xs text-text-muted truncate">{opt.description}</span>
      </span>
      {suggested && (
        <span
          className="flex-shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5"
          style={{ background: `${opt.color}20`, color: opt.color }}
        >
          {reason}
        </span>
      )}
    </button>
  );
}

export function TypeList({
  options,
  suggestion,
  onSelect,
}: {
  options: TypeOption[];
  /** Route-derived hint; types absent from `options` are dropped. */
  suggestion: CreateSuggestion | null;
  onSelect: (t: CreateableType) => void;
}) {
  // Kept in the suggestion's own order (most likely first), not the registry's.
  const suggested = suggestion
    ? suggestion.types
        .map((t) => options.find((o) => o.id === t))
        .filter((o): o is TypeOption => Boolean(o))
    : [];
  const suggestedIds = new Set(suggested.map((o) => o.id));
  const rest = suggested.length ? options.filter((o) => !suggestedIds.has(o.id)) : options;

  return (
    <div className="flex flex-col gap-5">
      {suggested.length > 0 && suggestion && (
        <div>
          <SectionLabel>Suggested</SectionLabel>
          <div className="flex flex-col gap-2">
            {suggested.map((opt, i) => (
              <TypeRow
                key={opt.id}
                opt={opt}
                onSelect={onSelect}
                suggested
                reason={i === 0 ? suggestion.reason : undefined}
              />
            ))}
          </div>
        </div>
      )}
      <div>
        {suggested.length > 0 && <SectionLabel>Everything else</SectionLabel>}
        <div className="flex flex-col gap-2">
          {rest.map((opt) => (
            <TypeRow key={opt.id} opt={opt} onSelect={onSelect} />
          ))}
        </div>
      </div>
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

// Exported so the note-first surface's Location property row gets the same
// keyboard-navigable picker the modal has, rather than a second implementation.
export function LocationAutocomplete({
  value,
  onChange,
  placeholder = 'e.g. San Francisco, United States',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
        placeholder={placeholder}
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
      <EntityNotePreview dir="people" name={data.name} />
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
  entityDir = 'events',
}: {
  data: EventFormData;
  onChange: (d: EventFormData) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  /** Note namespace for the kind being created — this form backs Resource too. */
  entityDir?: string;
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
      <EntityNotePreview dir={entityDir} name={data.name} />
    </div>
  );
}

// ─── Channel Form ───────────────────────────────────────────────────────────

export interface ChannelFormData {
  name: string;
  description: string;
  icon: string | null;
  viewMode: ChannelViewMode;
  spaceId: string;
  /** Starting text for the channel's context note (channels/<slug>.md). */
  context: string;
}

export function ChannelForm({
  data,
  onChange,
  nameRef,
  spaces,
}: {
  data: ChannelFormData;
  onChange: (d: ChannelFormData) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  spaces: ChannelSpaceEntry[];
}) {
  const [showIconPicker, setShowIconPicker] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Field label="Channel Name" required>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowIconPicker((v) => !v)}
              title="Channel icon (default #)"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-default bg-surface-2 text-text-secondary transition-colors hover:border-brand-green/40"
            >
              <ChannelIcon icon={data.icon} className="h-4 w-4" />
            </button>
            {showIconPicker && (
              <div className="absolute left-0 top-11 z-30">
                <EmojiIconPicker
                  onSelect={(emoji) => { onChange({ ...data, icon: emoji }); setShowIconPicker(false); }}
                  onClear={data.icon ? () => { onChange({ ...data, icon: null }); setShowIconPicker(false); } : undefined}
                  onClose={() => setShowIconPicker(false)}
                />
              </div>
            )}
          </div>
          <input
            ref={nameRef as React.RefObject<HTMLInputElement>}
            className={inputClass}
            placeholder="e.g. general"
            maxLength={80}
            value={data.name}
            onChange={(e) => onChange({ ...data, name: e.target.value })}
          />
        </div>
      </Field>
      <Field label="Description">
        <input
          className={inputClass}
          placeholder="What's this channel about?"
          maxLength={500}
          value={data.description}
          onChange={(e) => onChange({ ...data, description: e.target.value })}
        />
      </Field>
      <Field label="View style">
        <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
          {([
            { mode: 'CHAT' as const, label: 'Chat', icon: MessageCircle, title: 'Classic channel thread' },
            { mode: 'FEED' as const, label: 'Feed', icon: Newspaper, title: 'Post cards with comments' },
          ]).map(({ mode, label, icon: Icon, title }) => {
            const active = data.viewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                title={title}
                onClick={() => onChange({ ...data, viewMode: mode })}
                className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  active ? 'bg-brand-green text-white shadow-sm' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </Field>
      {spaces.length > 0 && (
        <Field label="Space">
          <select
            className={inputClass}
            value={data.spaceId}
            onChange={(e) => onChange({ ...data, spaceId: e.target.value })}
          >
            <option value="">No space</option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.emoji ? `${space.emoji} ` : ''}{space.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Starting context">
        <textarea
          className={`${inputClass} resize-none`}
          rows={3}
          placeholder="Optional — what this channel is for. You can keep writing after it's created."
          value={data.context}
          onChange={(e) => onChange({ ...data, context: e.target.value })}
        />
      </Field>
      <EntityNotePreview dir="channels" name={data.name} />
    </div>
  );
}

// ─── Space Form ─────────────────────────────────────────────────────────────

export interface SpaceFormData {
  name: string;
  /** Starting text for the space's context note (spaces/<slug>.md). */
  context: string;
}

export function SpaceForm({
  data,
  onChange,
  nameRef,
}: {
  data: SpaceFormData;
  onChange: (d: SpaceFormData) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Space Name" required>
        <input
          ref={nameRef as React.RefObject<HTMLInputElement>}
          className={inputClass}
          placeholder="e.g. Engineering"
          maxLength={80}
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
        />
      </Field>
      <Field label="Starting context">
        <textarea
          className={`${inputClass} resize-none`}
          rows={3}
          placeholder="Optional — what this space is for. You can keep writing after it's created."
          value={data.context}
          onChange={(e) => onChange({ ...data, context: e.target.value })}
        />
      </Field>
      <EntityNotePreview dir="spaces" name={data.name} />
      <p className="text-xs text-text-muted">
        Spaces group related channels together in the sidebar. You can file channels into this space when you create them.
      </p>
    </div>
  );
}

// ─── Context (note) Form ────────────────────────────────────────────────────

export interface ContextFormData {
  title: string;
  folder: string;
  tags: string;
  body: string;
}

export function ContextForm({
  data,
  onChange,
  nameRef,
  folders,
  contextName,
  destination,
  renamed,
  loading,
}: {
  data: ContextFormData;
  onChange: (d: ContextFormData) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  folders: FolderOption[];
  contextName: string;
  /** The exact path this note will be written to (de-duplicated). */
  destination: string;
  /** True when the title's natural filename was taken and a suffix was added. */
  renamed: boolean;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Title" required>
        <input
          ref={nameRef as React.RefObject<HTMLInputElement>}
          className={inputClass}
          placeholder="e.g. Fundraising playbook"
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
      </Field>
      <Field label="Folder">
        <FolderPicker
          folders={folders}
          value={data.folder}
          onChange={(folder) => onChange({ ...data, folder })}
          contextName={contextName}
        />
      </Field>
      <Field label="Tags">
        <input
          className={inputClass}
          placeholder="playbook, gtm"
          value={data.tags}
          onChange={(e) => onChange({ ...data, tags: e.target.value })}
        />
      </Field>
      <Field label="Starting text">
        <textarea
          className={`${inputClass} resize-none`}
          rows={4}
          placeholder="Optional — anything you already know. You can keep writing after it's created."
          value={data.body}
          onChange={(e) => onChange({ ...data, body: e.target.value })}
        />
      </Field>
      {data.title.trim() && (
        <PathPreview path={destination} taken={renamed} />
      )}
      {loading && <p className="text-[11px] text-text-muted">Loading folders…</p>}
    </div>
  );
}

// ─── Connector Form ─────────────────────────────────────────────────────────

export interface ConnectorFormData {
  name: string;
  description: string;
  /** One `host` or `host:port` per line — what the sandbox may reach. Empty = no network yet. */
  hosts: string;
  /** Optional NAME of a stored secret, exposed to commands as $NAME. */
  secretName: string;
}

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const HOST_LINE_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

/**
 * A connector's name IS its filename and the handle agents call it by, so it's
 * slugified rather than validated-and-rejected — "My API" becomes `my-api`,
 * which is both a legal note path and a legal connector name.
 */
export function connectorSlug(name: string): string {
  return slugify(name).slice(0, 64);
}

/**
 * What's wrong with this draft, or null when it's ready. Mirrors the checks
 * parseConnectorPerimeter runs server-side so the panel can't write a note the
 * connectors layer would immediately call invalid.
 */
function connectorFormError(data: ConnectorFormData): string | null {
  const name = data.name.trim();
  if (!name) return null; // not an error yet — just nothing typed
  if (!connectorSlug(name)) return 'Use letters and numbers — that name has none.';
  for (const line of data.hosts.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (!HOST_LINE_RE.test(line)) {
      return `Bad host "${line}" — a bare hostname like api.stripe.com or db.internal:5432, no scheme or path.`;
    }
  }
  const secret = data.secretName.trim().toUpperCase();
  if (secret && !SECRET_NAME_RE.test(secret)) {
    return 'Secret names are UPPER_SNAKE_CASE: A-Z, 0-9 and _, starting with a letter.';
  }
  return null;
}

/** True when there's enough here to write a connector note. */
export function connectorFormReady(data: ConnectorFormData): boolean {
  return !!connectorSlug(data.name) && !connectorFormError(data);
}

export function ConnectorForm({
  data,
  onChange,
  nameRef,
}: {
  data: ConnectorFormData;
  onChange: (d: ConnectorFormData) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
}) {
  const error = connectorFormError(data);
  const slug = connectorSlug(data.name);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Name" required>
        <input
          ref={nameRef as React.RefObject<HTMLInputElement>}
          className={`${inputClass} font-mono`}
          placeholder="e.g. stripe"
          maxLength={64}
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
        />
      </Field>

      <Field label="Description">
        <input
          className={inputClass}
          placeholder="What this system is — agents read this to decide when to use it."
          value={data.description}
          onChange={(e) => onChange({ ...data, description: e.target.value })}
        />
      </Field>

      <Field label="Hosts">
        <textarea
          className={`${inputClass} font-mono resize-none`}
          rows={2}
          placeholder={'api.stripe.com'}
          value={data.hosts}
          onChange={(e) => onChange({ ...data, hosts: e.target.value })}
        />
      </Field>

      <Field label="Secret">
        <input
          className={`${inputClass} font-mono`}
          placeholder="STRIPE_KEY"
          value={data.secretName}
          onChange={(e) => onChange({ ...data, secretName: e.target.value })}
        />
      </Field>

      <p className="text-xs text-text-muted">
        Agents run JavaScript in an isolate that can only reach the hosts above. The secret&apos;s
        value is set on the connector&apos;s page afterwards and reaches the code as{' '}
        <span className="font-mono">env.{data.secretName.trim().toUpperCase() || 'NAME'}</span> — it never
        lives in the note.
      </p>

      {slug && <EntityNotePreview dir="connectors" name={slug} />}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-text-muted">
        Only community admins can create or edit connectors. Refine the note afterwards — its body is
        the documentation agents read.
      </p>
    </div>
  );
}

// ─── File (context source) Form ─────────────────────────────────────────────

type FileUploadStatus = 'queued' | 'uploading' | 'done' | 'failed';

export interface FileEntry {
  file: File;
  status: FileUploadStatus;
  /** Brain path the source landed at (set once uploaded). */
  path?: string;
  error?: string;
}

export interface FileFormData {
  files: FileEntry[];
  folder: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reject unsupported/oversized files at pick time, before any round-trip. */
function rejectionReason(file: File): string | null {
  if (!sourceKindOf(file.name)) return 'Unsupported type';
  if (file.size > MAX_SOURCE_BYTES) return `Over ${Math.round(MAX_SOURCE_BYTES / (1024 * 1024))} MB`;
  return null;
}

const STATUS_STYLE: Record<FileUploadStatus, { label: string; className: string }> = {
  queued: { label: 'Ready', className: 'text-text-muted' },
  uploading: { label: 'Uploading…', className: 'text-text-secondary' },
  done: { label: 'Added', className: 'text-brand-green' },
  failed: { label: 'Failed', className: 'text-red-500' },
};

export function FileForm({
  data,
  onChange,
  folders,
  contextName,
  loading,
}: {
  data: FileFormData;
  onChange: (d: FileFormData) => void;
  folders: FolderOption[];
  contextName: string;
  loading: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    const existing = new Set(data.files.map((f) => `${f.file.name}:${f.file.size}`));
    const next: FileEntry[] = [];
    for (const file of Array.from(incoming)) {
      if (existing.has(`${file.name}:${file.size}`)) continue;
      const reason = rejectionReason(file);
      next.push(reason ? { file, status: 'failed', error: reason } : { file, status: 'queued' });
    }
    if (next.length) onChange({ ...data, files: [...data.files, ...next] });
  };

  const removeAt = (index: number) => {
    onChange({ ...data, files: data.files.filter((_, i) => i !== index) });
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
          dragging
            ? 'border-brand-green bg-brand-green/10'
            : 'border-border-default bg-surface-2 hover:border-brand-green/60'
        }`}
      >
        <svg className="h-7 w-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        <span className="text-sm font-medium text-text-primary">
          Drop files here or <span className="text-brand-green">browse</span>
        </span>
        <span className="text-[11px] text-text-muted">
          {SOURCE_EXTENSIONS_LABEL} · up to {Math.round(MAX_SOURCE_BYTES / (1024 * 1024))} MB each
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={SOURCE_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {data.files.length > 0 && (
        <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
          {data.files.map((entry, i) => {
            const status = STATUS_STYLE[entry.status];
            return (
              <li
                key={`${entry.file.name}-${i}`}
                className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{entry.file.name}</p>
                  {/* A server error can be long (a provider's raw payload) —
                      keep the row one line and put the full text in the title. */}
                  <p className="truncate text-[11px] text-text-muted" title={entry.error ?? undefined}>
                    {formatBytes(entry.file.size)}
                    <span className={`ml-2 ${status.className}`}>{entry.error ?? status.label}</span>
                  </p>
                </div>
                {entry.status !== 'uploading' && (
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    aria-label={`Remove ${entry.file.name}`}
                    className="shrink-0 text-text-muted transition-colors hover:text-red-500"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Field label="Folder">
        <FolderPicker
          folders={folders}
          value={data.folder}
          onChange={(folder) => onChange({ ...data, folder })}
          contextName={contextName}
        />
      </Field>
      {/* Where each file will land. Uploads keep their own filename, so this is
          the one place a collision with an existing source is visible before the
          request — the server would otherwise reject it as a taken path. */}
      {data.files.length > 0 && (
        <div className="flex flex-col gap-1">
          {data.files.slice(0, 4).map((entry, i) => (
            <PathPreview
              key={`${entry.file.name}-preview-${i}`}
              path={data.folder ? `${data.folder}/${entry.file.name}` : entry.file.name}
            />
          ))}
          {data.files.length > 4 && (
            <p className="text-[11px] text-text-muted">+{data.files.length - 4} more</p>
          )}
        </div>
      )}
      <p className="text-xs text-text-muted">
        Uploaded files are read, split and indexed, so their contents answer questions across{' '}
        {contextName} — the original stays downloadable.
      </p>
      {loading && <p className="text-[11px] text-text-muted">Loading folders…</p>}
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

export function SuccessScreen({
  label,
  onClose,
  detail,
  verb = 'created',
  actionLabel,
  onAction,
}: {
  label: string;
  onClose: () => void;
  /** Past-tense verb after the label — uploads read "3 files added". */
  verb?: string;
  /** Replaces the generic "All done!" line (e.g. "3 files added to deals"). */
  detail?: string;
  /** Optional primary follow-through — "Open note" / "Open file". */
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
        style={{ background: 'color-mix(in srgb, var(--color-brand-green, #78d870) 20%, transparent)' }}
      >
        ✓
      </div>
      <div>
        <p className="font-semibold text-text-primary text-lg">{`${label} ${verb}`}</p>
        <p className="text-sm text-text-muted mt-1">{detail ?? 'All done!'}</p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="px-6 py-2 rounded-full bg-brand-green text-white text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            {actionLabel}
          </button>
        )}
        <button
          onClick={onClose}
          className={`px-6 py-2 rounded-full text-sm font-semibold transition-opacity hover:opacity-90 ${
            actionLabel && onAction
              ? 'border border-border-default text-text-secondary'
              : 'bg-brand-green text-white'
          }`}
        >
          Done
        </button>
      </div>
    </div>
  );
}
