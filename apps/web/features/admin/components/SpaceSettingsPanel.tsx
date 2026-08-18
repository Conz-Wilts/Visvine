'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2Icon } from '@/features/shared/icons';
import { Space } from '@/lib/types';
import { COUNTRIES, getCountry } from '@/lib/countries';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { Alert, Button, ConfirmDialog, CountryFlagIcon, Field, Input, Textarea, inputBaseClass } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useConsoleAction, useConsoleAutosave } from '@/features/admin/components/console/ConsoleSaveContext';
import { FetchJsonError, fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import SpaceImageUpload from '@/features/spaces/components/SpaceImageUpload';

interface Props {
  space: Space;
  onSaved: (updated: Partial<Space>) => void;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const iconProps = {
  className: 'h-5 w-5',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  viewBox: '0 0 24 24',
} as const;

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
            <CountryFlagIcon code={selected.code} className="w-[24px] h-[18px]" />
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
                    <CountryFlagIcon code={country.code} className="w-[22px] h-[16px]" />
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

export default function SpaceSettingsPanel({ space, onSaved }: Props) {
  const router = useRouter();
  const { refreshSpace } = useSpace();

  const [name, setName] = useState(space.name);
  const [nameError, setNameError] = useState('');
  const [description, setDescription] = useState(space.description);
  const [country, setCountry] = useState(space.country ?? '');
  const [location, setLocation] = useState(space.location ?? '');
  const [imageUrl, setImageUrl] = useState(space.imageUrl ?? '');
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    space.visibility === 'private' ? 'private' : 'public'
  );
  const [timezone, setTimezone] = useState(space.timezone ?? '');
  const [customEndpoint, setCustomEndpoint] = useState(space.agentConfig?.customEndpoint?.baseURL ?? '');
  const [endpointError, setEndpointError] = useState('');
  const timeZones = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  })();

  const [confirmPublic, setConfirmPublic] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [visibilityError, setVisibilityError] = useState('');

  const runAction = useConsoleAction();

  const saveSettings = async (patch: Record<string, unknown>) => {
    const data = await fetchJsonBody<{ space: Partial<Space> }>(`/api/communities/${space.id}/settings`, 'PUT', patch);
    onSaved(data.space);
  };

  // Every edit saves itself: text fields debounce, pickers persist instantly.
  const { queue, flush } = useConsoleAutosave(async (patch) => {
    try {
      await saveSettings(patch);
    } catch (err) {
      // The queue only reports "Couldn't save" — a rejected name needs to say
      // WHY, on the field the admin has to change. Re-thrown so the console
      // pill still shows the failure and offers its retry.
      if (err instanceof FetchJsonError && err.code === 'name_taken' && patch.name !== undefined) {
        setNameError(err.message);
      }
      throw err;
    }
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
    try {
      await fetchJson(`/api/data/communities?id=${space.id}`, { method: 'DELETE' });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete space');
      setConfirmDelete(false);
      return;
    }
    setConfirmDelete(false);
    await refreshSpace();
    router.replace('/directory');
  };

  const isPrivate = visibility === 'private';

  // Not the autosave queue like the other fields: going public can be REFUSED
  // (a public space's name must be free — lib/spaces/publicName.ts), and
  // the queue swallows the server's message. useConsoleAction reports into the
  // same console pill but re-throws, so the toggle can undo itself and say why.
  const applyVisibility = async (next: 'public' | 'private') => {
    const previous = visibility;
    setVisibilityError('');
    setVisibility(next);
    try {
      await runAction(() => saveSettings({ visibility: next }));
    } catch (err) {
      setVisibility(previous);
      setVisibilityError(err instanceof Error ? err.message : 'Failed to change visibility');
    }
  };

  // Going public exposes everything in here to anyone, so it asks first.
  // Going private is the safe direction and applies straight away.
  const handleVisibilityToggle = (nextIsPrivate: boolean) => {
    if (nextIsPrivate) void applyVisibility('private');
    else setConfirmPublic(true);
  };

  return (
    <div className="w-full space-y-8">
      {/* Avatar, name, blurb and where it is — one block, no heading: the field
          labels already say what each one is. Visibility rides on the avatar
          row: it's the setting with consequences for who sees the rest, so it
          stays at the top rather than getting buried below the form. */}
      <section>
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <SpaceImageUpload
              space={{ ...space, imageUrl }}
              onUploadComplete={url => {
                setImageUrl(url);
                onSaved({ imageUrl: url });
              }}
              size="xl"
            />
            <div className="flex flex-col items-end text-right">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <span className={isPrivate ? 'text-brand-dark-green' : 'text-text-muted'}>
                  {isPrivate ? <LockIcon /> : <GlobeIcon />}
                </span>
                {isPrivate ? 'Private' : 'Public'}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {isPrivate ? 'Invite or admin only' : 'Anyone can find and join'}
              </p>
              <Toggle
                className="mt-3"
                checked={isPrivate}
                onChange={handleVisibilityToggle}
                aria-label="Private space"
              />
            </div>
          </div>
          {/* A refused publish (name already taken by another public space)
              leaves the toggle back where it was — this says why, and the fix
              is the Name field right below. */}
          {visibilityError && <Alert variant="error">{visibilityError}</Alert>}
          <div className="space-y-5">
            <Field label="Name" error={nameError}>
              <Input
                type="text"
                required
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                onBlur={flush}
                placeholder="Space name"
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={3}
                value={description}
                onChange={e => {
                  setDescription(e.target.value);
                  queue({ description: e.target.value }, { debounceMs: 800 });
                }}
                onBlur={flush}
                placeholder="What brings this space together?"
              />
            </Field>
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
          </div>
        </div>
      </section>

      {/* Agents: the two space-level facts the agent notes must not carry — the
          timezone "daily at 07:00" means, and where a custom model endpoint
          points (the brief is member-writable; an open URL there would let any
          member POST the whole context to a host of their choosing). */}
      <section>
        <h3 className="mb-1 text-base font-semibold text-text-primary">Agents</h3>
        <p className="mb-4 text-sm text-text-muted">
          Defaults for scheduled agents. Model keys are managed on the Agents page.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Timezone" hint="What an agent's “daily at 07:00” means, unless the agent names its own.">
            <select
              className={inputBaseClass}
              value={timezone}
              onChange={e => {
                setTimezone(e.target.value);
                queue({ timezone: e.target.value || null });
              }}
            >
              <option value="">UTC (default)</option>
              {timeZones.map(z => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Custom model endpoint"
            hint="Optional. An OpenAI-compatible base URL (https) for agents that use model: custom/<id>. Where your notes are sent is an admin decision."
            error={endpointError}
          >
            <Input
              type="url"
              value={customEndpoint}
              placeholder="https://llm.example.com/v1/"
              onChange={e => {
                setCustomEndpoint(e.target.value);
                setEndpointError('');
              }}
              onBlur={async () => {
                const value = customEndpoint.trim();
                if (value === (space.agentConfig?.customEndpoint?.baseURL ?? '')) return;
                try {
                  await runAction(() => saveSettings({ agentConfig: { customEndpoint: value ? { baseURL: value } : null } }));
                } catch (err) {
                  setEndpointError(err instanceof Error ? err.message : 'Could not save the endpoint');
                }
              }}
            />
          </Field>
        </div>
      </section>

      {/* Hand-rolled rather than a SettingsSection: the red wash has to enclose
          the heading too, which that component's hairline-divider shell can't do.
          The button names the action, so there's no label row beside it. */}
      <section className="rounded-xl border border-red-300 bg-red-50 p-5">
        <h3 className="mb-4 text-base font-semibold text-red-600">Danger zone</h3>
        {deleteError && <Alert variant="error" className="mb-4">{deleteError}</Alert>}
        <Button
          variant="danger"
          className="inline-flex items-center gap-2 px-4 py-2.5 text-base font-semibold"
          onClick={() => { setDeleteError(''); setConfirmDelete(true); }}
        >
          <Trash2Icon size={18} aria-hidden />
          Delete this space
        </Button>
      </section>

      <ConfirmDialog
        open={confirmPublic}
        title="Make this space public?"
        body={
          <>
            Anyone will be able to find <span className="font-semibold">{space.name}</span> in
            Discover and join it without an invite.
          </>
        }
        confirmLabel="Make public"
        onConfirm={() => {
          void applyVisibility('public');
          setConfirmPublic(false);
        }}
        onClose={() => setConfirmPublic(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete space"
        body={
          <>
            This permanently deletes <span className="font-semibold">{space.name}</span> — every
            record, connection, note, post and membership in it. This cannot be undone.
          </>
        }
        confirmLabel="Delete space"
        destructive
        confirmText={space.name}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
