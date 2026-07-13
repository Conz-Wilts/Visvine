'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateModal, type CreateableType } from '@/lib/contexts/CreateModalContext';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { isFeatureEnabled } from '@/lib/features';
import { slugify } from '@/lib/eventUtils';
import type { CommunityAlias, CommunityFeatureConfig } from '@/lib/types';
import { aliasesForType } from '@/lib/types';
import { uploadCroppedNodeImage } from '@/lib/imageUpload';
import ImageCropper from '@/components/data/ImageCropper';
import { useNodeSearch, type NodeSearchResult } from '@/hooks/useNodeSearch';
import { notesApi } from '@/features/notes/lib/notesApi';
import MatchPanel from './MatchPanel';
import {
  TYPE_OPTIONS,
  TypeSelector,
  PersonForm, type PersonFormData,
  EventForm, type EventFormData,
  CommunityForm, type CommunityFormData,
  AliasSelector,
  SuccessScreen,
} from './CreateModalForms';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateNodeId(type: string, name: string): string {
  return `${type.toLowerCase()}:${slugify(name)}`;
}

// Fallback avatars for the finder panel, shown when a match has no image.
const PERSON_FINDER_ICON = (
  <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);
const RESOURCE_FINDER_ICON = (
  <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);
const EVENT_FINDER_ICON = (
  <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function CreateModal() {
  const router = useRouter();
  const { isOpen, defaultType, close } = useCreateModal();
  const { currentCommunity, refreshCommunity, isAdmin } = useCommunity();

  // The "Create new" grid: the registry's grid types, minus any whose feature is
  // off for this community (Context appears only where the notes feature is on;
  // Channel only for community admins where the channels feature is on).
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;
  const notesEnabled = isFeatureEnabled(featureConfig, 'notes');
  const channelsEnabled = isFeatureEnabled(featureConfig, 'channels');

  // Context also requires write access to this community's brain root: check the
  // folder registry's gate when the modal opens. Personal spaces (`me:`) are
  // always writable by their owner; while the check is in flight (or on failure)
  // the tile stays hidden rather than offering a create that would 403.
  const isPersonalSpace = currentCommunity?.id.startsWith('me:') ?? false;
  const [brainWritable, setBrainWritable] = useState(false);
  useEffect(() => {
    if (!isOpen || !notesEnabled || !currentCommunity) return;
    if (isPersonalSpace) {
      setBrainWritable(true);
      return;
    }
    let alive = true;
    setBrainWritable(false);
    notesApi
      .getRegistry(currentCommunity.id)
      .then((r) => {
        if (alive) setBrainWritable(r.gate.canWrite);
      })
      .catch(() => {
        if (alive) setBrainWritable(false);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, notesEnabled, isPersonalSpace, currentCommunity]);

  const gridOptions = TYPE_OPTIONS.filter(
    (o) =>
      o.inGrid &&
      (o.id !== 'context' || (notesEnabled && brainWritable)) &&
      (o.id !== 'channel' || (channelsEnabled && isAdmin)),
  );

  // Step 0 = type select, 1 = form, 2 = alias (person only), 3 = success
  const [step, setStep] = useState(0);
  const [selectedType, setSelectedType] = useState<CreateableType | null>(null);
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  // Canonical identity chosen from the finder ("this is the existing Craig Piggott").
  // Cleared the moment the user edits the form, so an edited entry isn't mis-attached.
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cropperFile, setCropperFile] = useState<File | null>(null);
  const [personData, setPersonData] = useState<PersonFormData>({ name: '', email: '', subtitle: '', location: '', tags: '', imageBlob: null, imagePreview: null });
  const [resourceData, setResourceData] = useState<EventFormData>({ name: '', subtitle: '', location: '', tags: '' });
  const [eventData, setEventData] = useState<EventFormData>({ name: '', subtitle: '', location: '', tags: '' });
  const [communityData, setCommunityData] = useState<CommunityFormData>({ name: '', description: '', location: '', visibility: 'public' });

  const nameRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Cross-community finder — one search per addable node type. Inactive types
  // have an empty name, so their hook short-circuits without fetching.
  const personSearch = useNodeSearch(personData.name, 'person', personData.email);
  const resourceSearch = useNodeSearch(resourceData.name, 'resource');
  const eventSearch = useNodeSearch(eventData.name, 'event');

  const handleMatchSelect = (r: NodeSearchResult) => {
    if (personData.imagePreview && personData.imagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(personData.imagePreview);
    }
    setPersonData({
      name: r.name,
      email: (r.metadata?.email as string) || '',
      subtitle: r.subtitle || '',
      location: r.location || '',
      tags: (r.tags || []).join(', '),
      imageBlob: null,
      imagePreview: r.image_url || null,
    });
    // Attach the new community node to the SAME canonical identity (if resolved),
    // so adding someone another community already has doesn't create a duplicate.
    setSelectedIdentityId(r.identity_id ?? null);
  };

  // Any manual edit detaches from a previously picked identity — the server will
  // then resolve the (now possibly different) person from scratch.
  const handlePersonChange = (next: PersonFormData) => {
    setSelectedIdentityId(null);
    setPersonData(next);
  };

  const handleResourceMatch = (r: NodeSearchResult) => {
    setResourceData({
      name: r.name,
      subtitle: r.subtitle || '',
      location: r.location || '',
      tags: (r.tags || []).join(', '),
    });
  };

  const handleEventMatch = (r: NodeSearchResult) => {
    setEventData({
      name: r.name,
      subtitle: r.subtitle || '',
      location: r.location || '',
      tags: (r.tags || []).join(', '),
    });
  };

  // Aliases from current community, filtered to the selected node type
  const allAliases = (currentCommunity?.communityAliases as CommunityAlias[] | undefined) ?? [];
  const nodeTypeName = selectedType === 'person' ? 'Person'
    : selectedType === 'resource' ? 'Resource'
    : selectedType === 'event' ? 'Event'
    : null;
  const aliases = aliasesForType(allAliases, nodeTypeName);
  const hasAliases = aliases.length > 0;

  const reset = useCallback(() => {
    setStep(0);
    setSelectedType(null);
    setSelectedAlias(null);
    setSelectedIdentityId(null);
    setSaving(false);
    setError(null);
    setCropperFile(null);
    setPersonData({ name: '', email: '', subtitle: '', location: '', tags: '', imageBlob: null, imagePreview: null });
    setResourceData({ name: '', subtitle: '', location: '', tags: '' });
    setEventData({ name: '', subtitle: '', location: '', tags: '' });
    setCommunityData({ name: '', description: '', location: '', visibility: 'public' });
  }, []);

  // On open, if a default type is given skip to step 1
  useEffect(() => {
    if (isOpen) {
      if (defaultType) {
        setSelectedType(defaultType);
        setStep(1);
      } else {
        setStep(0);
        setSelectedType(null);
      }
      setError(null);
    }
  }, [isOpen, defaultType]);

  // Auto-focus the name field when entering step 1
  useEffect(() => {
    if (step === 1) {
      const t = setTimeout(() => nameRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [step]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    if (isOpen) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = () => {
    close();
    setTimeout(reset, 300);
  };

  const handleTypeSelect = (t: CreateableType) => {
    // Context isn't created here — it lives in the Directory's Context view.
    // Close and hand off to the embedded notes workspace, which auto-creates a
    // "New note" (see ?new=note).
    if (t === 'context') {
      handleClose();
      router.push('/directory?view=context&new=note');
      return;
    }
    // Channels aren't created here either — hand off to the Channels page, which
    // auto-opens its channel-creation form (see ?new=channel in MessagesClient).
    if (t === 'channel') {
      handleClose();
      router.push('/channels?new=channel');
      return;
    }
    setSelectedType(t);
    setStep(1);
  };

  const handleBack = () => {
    if (step === 1) setStep(0);
    else if (step === 2) setStep(1);
  };

  // ── Validate current step ──
  const canAdvance = (): boolean => {
    if (step === 0) return selectedType !== null;
    if (step === 1) {
      if (selectedType === 'person') return personData.name.trim().length > 0;
      if (selectedType === 'resource') return resourceData.name.trim().length > 0;
      if (selectedType === 'event') return eventData.name.trim().length > 0;
      if (selectedType === 'community') return communityData.name.trim().length > 0;
    }
    return true;
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canAdvance()) return;

    // If this type has aliases and we haven't shown the alias step yet
    if (step === 1 && hasAliases) {
      setStep(2);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (selectedType === 'community') {
        await createCommunity();
      } else {
        await createNode();
      }
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const createNode = async () => {
    if (!currentCommunity) throw new Error('Select a community first');

    let name = '';
    let subtitle = '';
    let location = '';
    let tags: string[] = [];
    let type = '';

    if (selectedType === 'person') {
      name = personData.name.trim();
      subtitle = personData.subtitle.trim();
      location = personData.location.trim();
      tags = personData.tags.split(',').map(t => t.trim()).filter(Boolean);
      type = 'person';
    } else if (selectedType === 'resource') {
      name = resourceData.name.trim();
      subtitle = resourceData.subtitle.trim();
      location = resourceData.location.trim();
      tags = resourceData.tags.split(',').map(t => t.trim()).filter(Boolean);
      type = 'resource';
    } else if (selectedType === 'event') {
      name = eventData.name.trim();
      subtitle = eventData.subtitle.trim();
      location = eventData.location.trim();
      tags = eventData.tags.split(',').map(t => t.trim()).filter(Boolean);
      type = 'event';
    }

    const baseId = generateNodeId(type, name);

    // Check uniqueness by trying a GET first
    const existing = await fetch(`/api/data/nodes?community_id=${currentCommunity.id}`).then(r => r.json());
    const ids = new Set<string>((existing.nodes ?? []).map((n: { id: string }) => n.id));
    let id = baseId;
    let counter = 2;
    while (ids.has(id)) id = `${baseId}-${counter++}`;

    const res = await fetch('/api/data/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        community_id: currentCommunity.id,
        // When the user picked an existing person from the finder, tell the server
        // to attach this node to that canonical identity instead of resolving anew.
        identity_id: selectedType === 'person' ? (selectedIdentityId ?? undefined) : undefined,
        node: {
          id,
          type,
          name,
          subtitle: subtitle || undefined,
          location: location || undefined,
          tags,
          url: `/${slugify(name)}`,
          alias: selectedAlias || undefined,
          metadata: selectedType === 'person' && personData.email.trim()
            ? { email: personData.email.trim() }
            : undefined,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to create');
    }

    // Set image if provided (person only)
    if (selectedType === 'person') {
      const imageUrl = personData.imageBlob
        ? await uploadCroppedNodeImage(id, personData.imageBlob).catch(() => null)
        : personData.imagePreview && !personData.imagePreview.startsWith('blob:')
          ? personData.imagePreview  // auto-filled URL from matched person
          : null;

      if (imageUrl) {
        try {
          await fetch('/api/data/nodes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              community_id: currentCommunity.id,
              node: { id, type, name, image_url: imageUrl },
            }),
          });
        } catch {
          // Image failure is non-fatal
        }
      }
    }
  };

  const createCommunity = async () => {
    const name = communityData.name.trim();

    // User-facing create: any signed-in user, server derives the id and makes the
    // creator an admin. (The /api/data/communities POST is super-admin-only bulk.)
    const res = await fetch('/api/communities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: communityData.description.trim(),
        location: communityData.location.trim() || undefined,
        visibility: communityData.visibility,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to create');
    }

    await refreshCommunity();
  };

  // ─────────────────────────────────────────────────────────────────────────
  const handleCropDone = (blob: Blob) => {
    if (personData.imagePreview) URL.revokeObjectURL(personData.imagePreview);
    const preview = URL.createObjectURL(blob);
    setPersonData(d => ({ ...d, imageBlob: blob, imagePreview: preview }));
    setCropperFile(null);
  };

  if (!isOpen) return null;

  const typeOpt = selectedType ? TYPE_OPTIONS.find(o => o.id === selectedType) : null;
  const successLabel = typeOpt
    ? selectedType === 'person'
      ? personData.name || 'People'
      : selectedType === 'resource'
      ? resourceData.name || 'Resource'
      : selectedType === 'event'
      ? eventData.name || 'Event'
      : communityData.name || 'Community'
    : '';

  const stepTitles: Record<number, string> = {
    0: 'What are you creating?',
    1: typeOpt ? `New ${typeOpt.label}` : '',
    2: 'Assign a role alias',
    3: '',
  };

  return (
    <>
      {/* Image cropper — renders above the modal when a file is selected */}
      {cropperFile && (
        <div className="relative z-[60]">
          <ImageCropper
            imageFile={cropperFile}
            onCrop={handleCropDone}
            onCancel={() => setCropperFile(null)}
            shape="square"
            outputWidth={400}
            outputHeight={400}
          />
        </div>
      )}

      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
      >
        {/* Panel */}
        <div
          className={`relative w-full rounded-2xl border border-border-subtle bg-surface-1 shadow-2xl ${
            step === 1 && (selectedType === 'person' || selectedType === 'resource' || selectedType === 'event')
              ? 'max-w-3xl'
              : 'max-w-sm'
          }`}
          style={{ animation: 'modalIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both' }}
        >
          {/* Header */}
          {step < 3 && (
            <div className="relative flex items-center justify-center px-6 pt-6 pb-4 border-b border-border-subtle">
              {step > 0 && (
                <button
                  onClick={handleBack}
                  className="absolute left-6 w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:bg-surface-2 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <div className="text-center">
                {typeOpt && step > 0 && (
                  <p className="text-xs text-text-muted mb-0.5">{typeOpt.label}</p>
                )}
                <h2 className="font-semibold text-text-primary text-base">{stepTitles[step]}</h2>
              </div>
              <button
                onClick={handleClose}
                className="absolute right-6 w-8 h-8 rounded-full flex items-center justify-center bg-red-400 hover:scale-110 transition-transform"
              >
                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Body */}
          <div className="px-6 py-5">
            {step === 0 && (
              <TypeSelector options={gridOptions} selected={selectedType} onSelect={handleTypeSelect} />
            )}

            {step === 1 && selectedType === 'person' && (
              <div className="flex gap-6">
                {/* Form — left */}
                <div className="flex-1 min-w-0">
                  <PersonForm
                    data={personData}
                    onChange={handlePersonChange}
                    nameRef={nameRef}
                    onCropRequest={setCropperFile}
                  />
                </div>
                {/* Match panel — right */}
                <div className="w-72 flex-shrink-0 border-l border-border-subtle pl-5">
                  <MatchPanel
                    results={personSearch.results}
                    loading={personSearch.loading}
                    onSelect={handleMatchSelect}
                    title="Existing People"
                    emptyHint="Type a name or email to find existing people across communities."
                    fallbackIcon={PERSON_FINDER_ICON}
                  />
                </div>
              </div>
            )}
            {step === 1 && selectedType === 'resource' && (
              <div className="flex gap-6">
                {/* Form — left */}
                <div className="flex-1 min-w-0">
                  <EventForm data={resourceData} onChange={setResourceData} nameRef={nameRef} />
                </div>
                {/* Match panel — right */}
                <div className="w-72 flex-shrink-0 border-l border-border-subtle pl-5">
                  <MatchPanel
                    results={resourceSearch.results}
                    loading={resourceSearch.loading}
                    onSelect={handleResourceMatch}
                    title="Existing Resources"
                    emptyHint="Type a name to find existing resources across communities."
                    fallbackIcon={RESOURCE_FINDER_ICON}
                  />
                </div>
              </div>
            )}
            {step === 1 && selectedType === 'event' && (
              <div className="flex gap-6">
                {/* Form — left */}
                <div className="flex-1 min-w-0">
                  <EventForm data={eventData} onChange={setEventData} nameRef={nameRef} />
                </div>
                {/* Match panel — right */}
                <div className="w-72 flex-shrink-0 border-l border-border-subtle pl-5">
                  <MatchPanel
                    results={eventSearch.results}
                    loading={eventSearch.loading}
                    onSelect={handleEventMatch}
                    title="Existing Events"
                    emptyHint="Type a name to find existing events across communities."
                    fallbackIcon={EVENT_FINDER_ICON}
                  />
                </div>
              </div>
            )}
            {step === 1 && selectedType === 'community' && (
              <CommunityForm data={communityData} onChange={setCommunityData} nameRef={nameRef} />
            )}

            {step === 2 && (
              <AliasSelector
                aliases={aliases}
                selected={selectedAlias}
                onSelect={setSelectedAlias}
              />
            )}

            {step === 3 && (
              <SuccessScreen label={successLabel} onClose={handleClose} />
            )}

            {error && (
              <p className="mt-3 text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          {step > 0 && step < 3 && (
            <div className="px-6 pb-6 flex justify-end">
              <button
                onClick={handleSubmit}
                disabled={!canAdvance() || saving}
                className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                style={{ background: 'var(--color-brand-green, #78d870)' }}
              >
                {saving ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Saving…
                  </>
                ) : step === 1 && hasAliases ? (
                  'Next →'
                ) : (
                  'Create'
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </>
  );
}
