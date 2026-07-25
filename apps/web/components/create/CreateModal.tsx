'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCreateModal, type CreateableType } from '@/lib/contexts/CreateModalContext';
import { suggestedCreateType } from '@/lib/create/suggestedType';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { isFeatureEnabled } from '@/lib/features';
import { slugify } from '@/lib/eventUtils';
import type { CommunityAlias, CommunityFeatureConfig } from '@/lib/types';
import { aliasesForType } from '@/lib/types';
import { uploadCroppedNodeImage } from '@/lib/imageUpload';
import ImageCropper from '@/components/data/ImageCropper';
import SidePanel from '@/components/ui/SidePanel';
import { useNodeSearch, type NodeSearchResult } from '@/hooks/useNodeSearch';
import MatchPanel from './MatchPanel';
import {
  TYPE_OPTIONS,
  TypeList,
  PersonForm, type PersonFormData,
  EventForm, type EventFormData,
  CommunityForm, type CommunityFormData,
  ChannelForm, type ChannelFormData,
  SpaceForm, type SpaceFormData,
  ContextForm, type ContextFormData,
  FileForm, type FileFormData, type FileEntry,
  AliasSelector,
  SuccessScreen,
} from './CreateModalForms';
import { useBrainTree } from './ContextDestination';
import type { ChannelSpaceEntry } from '@/lib/messages/types';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { availableNotePath, composeNotePath, newNoteContent } from '@/lib/notes/shared/newContext';
import { noteHref, sourceHref } from '@/lib/notes/entities';

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
  const pathname = usePathname();
  const { isOpen, defaultType, close } = useCreateModal();
  const { currentCommunity, refreshCommunity, isAdmin } = useCommunity();

  // The "Create new" grid: the registry's grid types, minus any whose feature is
  // off for this community (Channel only for community admins where the
  // channels feature is on). Context isn't created here — an entity's context
  // note lives on its profile's Context tab and is created on first save.
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;
  const channelsEnabled = isFeatureEnabled(featureConfig, 'channels');
  // Context notes and uploaded files both land in the community brain, so both
  // tiles follow the notes ("Context") feature.
  const notesEnabled = isFeatureEnabled(featureConfig, 'notes');

  // Channels and Spaces are community-admin surfaces, only shown when the
  // channels feature is on for this community.
  const gridOptions = TYPE_OPTIONS.filter((o) => {
    if (!o.inGrid) return false;
    if (o.id === 'channel' || o.id === 'space') return channelsEnabled && isAdmin;
    if (o.id === 'context' || o.id === 'file') return notesEnabled;
    return true;
  });

  // What the current page implies you came here to create — dropped when that
  // type isn't offered in this community (e.g. Channel with channels off).
  const routeSuggestion = suggestedCreateType(pathname);
  const suggestion =
    routeSuggestion && gridOptions.some((o) => o.id === routeSuggestion.type)
      ? routeSuggestion
      : null;

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
  const [channelData, setChannelData] = useState<ChannelFormData>({ name: '', description: '', icon: null, viewMode: 'CHAT', spaceId: '' });
  const [spaceData, setSpaceData] = useState<SpaceFormData>({ name: '' });
  const [contextData, setContextData] = useState<ContextFormData>({ title: '', folder: '', tags: '', body: '' });
  const [fileData, setFileData] = useState<FileFormData>({ files: [], folder: '' });
  // Where the just-created note/file lives, so the success screen can offer to
  // open it (null for types that have no viewer to jump to).
  const [createdHref, setCreatedHref] = useState<string | null>(null);
  const [createdDetail, setCreatedDetail] = useState<string | null>(null);
  // Spaces for the channel form's "file into space" dropdown, loaded lazily when
  // the Channel form opens.
  const [spaces, setSpaces] = useState<ChannelSpaceEntry[]>([]);

  // Folder list + existing note paths for the brain forms, loaded (from the
  // shared context cache) only while one of them is open.
  const brainForm = selectedType === 'context' || selectedType === 'file';
  const brainTree = useBrainTree(currentCommunity?.id ?? null, isOpen && brainForm);
  const contextName = currentCommunity?.name ?? 'Context';

  // The note's real destination: the title's slug in the chosen folder, suffixed
  // when that path is already taken, so the preview matches what gets written.
  const contextTitle = contextData.title.trim();
  const contextDestination = useMemo(
    () => availableNotePath(contextData.folder, contextTitle || 'untitled', brainTree.notePaths),
    [contextData.folder, contextTitle, brainTree.notePaths],
  );
  const contextRenamed =
    contextDestination !== composeNotePath(contextData.folder, contextTitle || 'untitled');

  const nameRef = useRef<HTMLInputElement | null>(null);

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
    setChannelData({ name: '', description: '', icon: null, viewMode: 'CHAT', spaceId: '' });
    setSpaceData({ name: '' });
    setContextData({ title: '', folder: '', tags: '', body: '' });
    setFileData({ files: [], folder: '' });
    setCreatedHref(null);
    setCreatedDetail(null);
  }, []);

  // Load the community's spaces once the Channel form is showing, so the user can
  // file the new channel into one on creation.
  useEffect(() => {
    if (!isOpen || selectedType !== 'channel' || !currentCommunity) return;
    let cancelled = false;
    fetch(`/api/messages/spaces?communityId=${encodeURIComponent(currentCommunity.id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { spaces: [] }))
      .then((payload) => { if (!cancelled) setSpaces(payload.spaces ?? []); })
      .catch(() => { if (!cancelled) setSpaces([]); });
    return () => { cancelled = true; };
  }, [isOpen, selectedType, currentCommunity]);

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

  const handleClose = () => {
    close();
    setTimeout(reset, 300);
  };

  const handleTypeSelect = (t: CreateableType) => {
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
      if (selectedType === 'channel') return channelData.name.trim().length > 0;
      if (selectedType === 'space') return spaceData.name.trim().length > 0;
      if (selectedType === 'context') return contextTitle.length > 0;
      // Only files that passed the pick-time check can be uploaded.
      if (selectedType === 'file') return fileData.files.some((f) => f.status === 'queued');
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
        setStep(3);
      } else if (selectedType === 'channel') {
        // Land the user straight in the new channel — the channels page mounts
        // fresh and picks it up (no success screen needed).
        const id = await createChannel();
        handleClose();
        router.push(`/channels/${encodeURIComponent(id)}`);
      } else if (selectedType === 'space') {
        await createSpace();
        handleClose();
        router.push('/channels');
      } else if (selectedType === 'context') {
        await createContextNote();
        setStep(3);
      } else if (selectedType === 'file') {
        await uploadFiles();
        setStep(3);
      } else {
        await createNode();
        setStep(3);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const createChannel = async (): Promise<string> => {
    if (!currentCommunity) throw new Error('Select a community first');
    const res = await fetch('/api/messages/conversations/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        communityId: currentCommunity.id,
        name: channelData.name.trim(),
        description: channelData.description.trim() || undefined,
        icon: channelData.icon ?? undefined,
        spaceId: channelData.spaceId || undefined,
        viewMode: channelData.viewMode,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to create channel');
    }
    const { conversation } = await res.json();
    return conversation.id as string;
  };

  const createSpace = async () => {
    if (!currentCommunity) throw new Error('Select a community first');
    const res = await fetch('/api/messages/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ communityId: currentCommunity.id, name: spaceData.name.trim() }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to create space');
    }
  };

  // ── Context note ──────────────────────────────────────────────────────────
  // Writes one note at the previewed path. The folder gate lives server-side
  // (403 with its reason), and intermediate folders come into being with the
  // note, so a brand-new folder name needs no separate create call.
  const createContextNote = async () => {
    if (!currentCommunity) throw new Error('Select a community first');
    const path = contextDestination;
    const tags = contextData.tags.split(',').map((t) => t.trim()).filter(Boolean);
    await notesApi.create(
      currentCommunity.id,
      path,
      newNoteContent({ title: contextTitle, tags, body: contextData.body }),
    );
    // The tree, the note index and this path's (cached "missing") read all went
    // stale — the sidebar and the note view must see it immediately.
    invalidateContextCache(
      contextKeys.tree(currentCommunity.id),
      contextKeys.list(currentCommunity.id),
      contextKeys.read(currentCommunity.id, path),
    );
    setCreatedHref(noteHref(path));
    setCreatedDetail(`Saved to ${path}`);
  };

  // ── Files (context sources) ───────────────────────────────────────────────
  // Uploaded one at a time: each request runs the whole extract → chunk → embed
  // pipeline synchronously, so a parallel burst would just contend. Per-file
  // status lands on the row; a file that fails leaves the others alone.
  const uploadFiles = async () => {
    if (!currentCommunity) throw new Error('Select a community first');
    const communityId = currentCommunity.id;
    const queue = fileData.files
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.status === 'queued');

    const patch = (index: number, next: Partial<FileEntry>) => {
      setFileData((d) => ({
        ...d,
        files: d.files.map((f, i) => (i === index ? { ...f, ...next } : f)),
      }));
    };

    let uploaded = 0;
    let lastPath: string | null = null;
    for (const { entry, index } of queue) {
      patch(index, { status: 'uploading', error: undefined });
      try {
        const { source } = await notesApi.uploadSource(communityId, entry.file, fileData.folder);
        patch(index, { status: 'done', path: source.path });
        uploaded++;
        lastPath = source.path;
      } catch (err) {
        patch(index, {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    }

    if (!uploaded) throw new Error('No files could be uploaded — see the list above');

    invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId));
    const failed = queue.length - uploaded;
    setCreatedHref(uploaded === 1 && lastPath ? sourceHref(lastPath) : '/context');
    setCreatedDetail(
      `${uploaded} file${uploaded === 1 ? '' : 's'} added to ${fileData.folder || contextName}` +
        (failed ? ` · ${failed} failed` : ''),
    );
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

  // No early return on `!isOpen`: the panel stays mounted through its slide-out
  // animation, so the shell decides when to unmount. Everything below is cheap
  // and null-safe while closed.
  const typeOpt = selectedType ? TYPE_OPTIONS.find(o => o.id === selectedType) : null;
  const uploadedCount = fileData.files.filter((f) => f.status === 'done').length;
  const successLabel = typeOpt
    ? selectedType === 'person'
      ? personData.name || 'People'
      : selectedType === 'resource'
      ? resourceData.name || 'Resource'
      : selectedType === 'event'
      ? eventData.name || 'Event'
      : selectedType === 'context'
      ? contextTitle || 'Note'
      : selectedType === 'file'
      ? `${uploadedCount} file${uploadedCount === 1 ? '' : 's'}`
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

      {/* Backdrop + panel shell */}
      <SidePanel
        open={isOpen}
        onClose={handleClose}
        ariaLabel="Create new"
        // Pops out from the left beside the icon rail — same edge the channels
        // panel docks to — as an inset card rather than a full-height sheet.
        side="left"
        floating
        // Wide enough for the form + finder two-column layout on the entity
        // types; a narrow sheet everywhere else.
        widthClass={
          step === 1 && (selectedType === 'person' || selectedType === 'resource' || selectedType === 'event')
            ? 'sm:w-[800px]'
            : 'sm:w-[440px]'
        }
      >
          {/* Header */}
          {step < 3 && (
            <div className="flex items-center gap-2 px-6 py-4 border-b border-border-subtle flex-shrink-0">
              {step > 0 && (
                <button
                  onClick={handleBack}
                  aria-label="Back"
                  className="w-7 h-7 -ml-1.5 flex-shrink-0 rounded-full flex items-center justify-center text-text-muted hover:bg-surface-2 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <div className="min-w-0 flex-1">
                {typeOpt && step > 0 && (
                  <p className="text-xs text-text-muted mb-0.5">{typeOpt.label}</p>
                )}
                <h2 className="font-semibold text-text-primary text-base truncate">{stepTitles[step]}</h2>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close"
                className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center text-text-muted hover:bg-surface-2 hover:text-text-primary transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Body — the success screen is small and headerless, so it centers in
              the full-height panel rather than clinging to the top. */}
          <div
            className={`px-6 py-5 flex-1 overflow-y-auto ${
              step === 3 ? 'flex flex-col justify-center' : ''
            }`}
          >
            {step === 0 && (
              <TypeList options={gridOptions} suggestion={suggestion} onSelect={handleTypeSelect} />
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
            {step === 1 && selectedType === 'channel' && (
              <ChannelForm data={channelData} onChange={setChannelData} nameRef={nameRef} spaces={spaces} />
            )}
            {step === 1 && selectedType === 'space' && (
              <SpaceForm data={spaceData} onChange={setSpaceData} nameRef={nameRef} />
            )}
            {step === 1 && selectedType === 'context' && (
              <ContextForm
                data={contextData}
                onChange={setContextData}
                nameRef={nameRef}
                folders={brainTree.folders}
                contextName={contextName}
                destination={contextDestination}
                renamed={contextRenamed}
                loading={brainTree.loading}
              />
            )}
            {step === 1 && selectedType === 'file' && (
              <FileForm
                data={fileData}
                onChange={setFileData}
                folders={brainTree.folders}
                contextName={contextName}
                loading={brainTree.loading}
              />
            )}

            {step === 2 && (
              <AliasSelector
                aliases={aliases}
                selected={selectedAlias}
                onSelect={setSelectedAlias}
              />
            )}

            {step === 3 && (
              <SuccessScreen
                label={successLabel}
                onClose={handleClose}
                detail={createdDetail ?? undefined}
                verb={selectedType === 'file' ? 'added' : 'created'}
                actionLabel={
                  createdHref ? (selectedType === 'file' ? 'Open' : 'Open note') : undefined
                }
                onAction={
                  createdHref
                    ? () => {
                        const href = createdHref;
                        handleClose();
                        router.push(href);
                      }
                    : undefined
                }
              />
            )}

            {error && (
              <p className="mt-3 text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          {step > 0 && step < 3 && (
            <div className="px-6 py-4 flex justify-end border-t border-border-subtle flex-shrink-0">
              <button
                onClick={handleSubmit}
                disabled={!canAdvance() || saving}
                className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                style={{ background: 'var(--color-brand-green, #78d870)' }}
              >
                {saving ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    {selectedType === 'file' ? 'Uploading…' : 'Saving…'}
                  </>
                ) : step === 1 && hasAliases ? (
                  'Next →'
                ) : selectedType === 'file' ? (
                  'Upload'
                ) : (
                  'Create'
                )}
              </button>
            </div>
          )}
      </SidePanel>
    </>
  );
}
