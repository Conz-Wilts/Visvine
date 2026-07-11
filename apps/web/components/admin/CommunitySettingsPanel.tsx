'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Community } from '@/lib/types';
import { COUNTRIES, countryCodeToFlag, getCountry } from '@/lib/countries';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { Alert, Button, ConfirmDialog, Field, Input, Textarea, SettingsCard, inputBaseClass } from '@/components/ui';
import { useConsoleAutosave } from '@/components/console/ConsoleSaveContext';
import CommunityImageUpload from '@/components/community/CommunityImageUpload';

interface Props {
  community: Community;
  onSaved: (updated: Partial<Community>) => void;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const iconProps = {
  className: 'h-5 w-5',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  viewBox: '0 0 24 24',
} as const;

const IdentityIcon = () => (
  <svg {...iconProps}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.5-4.66" />
  </svg>
);
const MapPinIcon = () => (
  <svg {...iconProps}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>
);
const GlobeIcon = () => (
  <svg {...iconProps} className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.5-2.4 3.75-5.4 3.75-9S14.5 5.4 12 3m0 18c-2.5-2.4-3.75-5.4-3.75-9S9.5 5.4 12 3M3.6 9h16.8M3.6 15h16.8" />
  </svg>
);
const LockIcon = () => (
  <svg {...iconProps} className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5v-6a1.5 1.5 0 011.5-1.5z" />
  </svg>
);

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
        className={`${inputBaseClass} flex items-center gap-2 text-left`}
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
            <Input
              ref={inputRef}
              type="text"
              placeholder="Search countries…"
              value={query}
              onChange={e => setQuery(e.target.value)}
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
  const router = useRouter();
  const { refreshCommunity } = useCommunity();

  const [name, setName] = useState(community.name);
  const [nameError, setNameError] = useState('');
  const [description, setDescription] = useState(community.description);
  const [country, setCountry] = useState(community.country ?? '');
  const [location, setLocation] = useState(community.location ?? '');
  const [tagsInput, setTagsInput] = useState((community.tags ?? []).join(', '));
  const [imageUrl, setImageUrl] = useState(community.imageUrl ?? '');
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    community.visibility === 'private' ? 'private' : 'public'
  );

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Every edit saves itself: text fields debounce, pickers persist instantly.
  const { queue, flush } = useConsoleAutosave(async (patch) => {
    const res = await fetch(`/api/communities/${community.id}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Failed to save');
    onSaved(data.community);
  });

  const handleNameChange = (value: string) => {
    setName(value);
    if (!value.trim()) {
      setNameError('Name is required');
      return;
    }
    setNameError('');
    queue({ name: value.trim() }, { debounceMs: 800 });
  };

  const handleDelete = async () => {
    setDeleteError('');
    const res = await fetch(`/api/data/communities?id=${community.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error ?? 'Failed to delete community');
      setConfirmDelete(false);
      return;
    }
    setConfirmDelete(false);
    await refreshCommunity();
    router.replace('/directory');
  };

  const tagList = tagsInput.split(',').map(t => t.trim()).filter(Boolean);

  const visibilityOptions = [
    { value: 'public', title: 'Public', desc: 'Discoverable & self-joinable', icon: <GlobeIcon /> },
    { value: 'private', title: 'Private', desc: 'Invite link or admin add only', icon: <LockIcon /> },
  ] as const;

  return (
    <div className="grid w-full grid-cols-1 items-start gap-6 xl:grid-cols-2">
      {/* Identity — image beside the core text fields */}
      <SettingsCard
        icon={<IdentityIcon />}
        title="Identity"
        description="The name, avatar, and blurb people see first."
        className="xl:col-span-2"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <CommunityImageUpload
              community={{ ...community, imageUrl }}
              onUploadComplete={url => {
                setImageUrl(url);
                onSaved({ imageUrl: url });
              }}
              size="lg"
            />
            <span className="text-xs text-text-muted">Logo</span>
          </div>
          <div className="flex-1 space-y-5">
            <Field label="Community name" error={nameError}>
              <Input
                type="text"
                required
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                onBlur={flush}
                placeholder="Your community name"
              />
            </Field>
            <Field label="Description" hint="A sentence or two about what this community is for.">
              <Textarea
                rows={3}
                value={description}
                onChange={e => {
                  setDescription(e.target.value);
                  queue({ description: e.target.value }, { debounceMs: 800 });
                }}
                onBlur={flush}
                placeholder="What brings this community together?"
              />
            </Field>
          </div>
        </div>
      </SettingsCard>

      {/* Location & tags */}
      <SettingsCard
        icon={<MapPinIcon />}
        title="Location & tags"
        description="Help the right people find and recognise your community."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Country">
            <CountrySelector
              value={country}
              onChange={code => {
                setCountry(code);
                queue({ country: code || null });
              }}
            />
          </Field>
          <Field label="Location">
            <Input
              type="text"
              value={location}
              onChange={e => {
                setLocation(e.target.value);
                queue({ location: e.target.value }, { debounceMs: 800 });
              }}
              onBlur={flush}
              placeholder="e.g. Auckland, New Zealand"
            />
          </Field>
        </div>

        <Field label="Tags" hint="Separate tags with commas.">
          <Input
            type="text"
            value={tagsInput}
            onChange={e => {
              setTagsInput(e.target.value);
              queue(
                { tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) },
                { debounceMs: 800 },
              );
            }}
            onBlur={flush}
            placeholder="tech, startup, community"
          />
          {tagList.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {tagList.map((tag, i) => (
                <span
                  key={`${tag}-${i}`}
                  className="inline-flex items-center rounded-full bg-brand-green/12 px-2.5 py-0.5 text-xs font-medium text-brand-dark-green"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </Field>
      </SettingsCard>

      {/* Visibility */}
      <SettingsCard
        icon={<GlobeIcon />}
        title="Visibility"
        description="Control who can find and join this community."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {visibilityOptions.map(opt => {
            const active = visibility === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setVisibility(opt.value);
                  queue({ visibility: opt.value });
                }}
                className={`group flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  active
                    ? 'border-brand-green bg-brand-green/8 ring-1 ring-brand-green/40'
                    : 'border-border-subtle hover:border-brand-green/50 hover:bg-surface-2'
                }`}
              >
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${
                    active ? 'bg-brand-green/20 text-brand-dark-green' : 'bg-surface-3 text-text-muted'
                  }`}
                >
                  {opt.icon}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                    {opt.title}
                    {active && (
                      <svg className="h-4 w-4 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-muted">{opt.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      {/* Danger zone */}
      <SettingsCard
        title="Danger zone"
        description="Irreversible actions for this community."
        className="border-red-500/30 xl:col-span-2"
      >
        {deleteError && <Alert variant="error">{deleteError}</Alert>}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-text-primary">Delete this community</div>
            <div className="mt-0.5 text-xs text-text-muted">
              Removes the community and its memberships. All people, organisations, and connections
              must be deleted first.
            </div>
          </div>
          <Button variant="pill-danger" onClick={() => { setDeleteError(''); setConfirmDelete(true); }}>
            Delete…
          </Button>
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete community"
        body={
          <>
            This permanently deletes <span className="font-semibold">{community.name}</span> and all of
            its memberships. This cannot be undone.
          </>
        }
        confirmLabel="Delete community"
        destructive
        confirmText={community.name}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
