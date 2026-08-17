'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import { useCreateModal, type CreateableType } from '@/features/shared/contexts/CreateModalContext';
import { suggestedCreateType } from '@/lib/create/suggestedType';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { canCreateType } from '@/lib/create/creatable';
import { slugify } from '@/lib/eventUtils';
import type { SpaceAlias, SpaceFeatureConfig } from '@/lib/types';
import { aliasesForType } from '@/lib/types';
import { uploadCroppedImage } from '@/lib/imageUpload';
import ImageCropper from '@/features/directory/components/data/ImageCropper';
import { useSidebar, DOCK_MS, DOCK_EASE } from '@/features/shared/contexts/SidebarContext';
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey';
import { useNodeSearch, type NodeSearchResult } from '@/features/shared/hooks/useNodeSearch';
import MatchPanel from './MatchPanel';
import {
  TYPE_OPTIONS,
  TypeList,
  PersonForm, type PersonFormData,
  EventForm, type EventFormData,
  ChannelForm, type ChannelFormData,
  SpaceForm, type SpaceFormData,
  ContextForm, type ContextFormData,
  ConnectorForm, type ConnectorFormData, connectorSlug, connectorFormReady,
  AgentForm, type AgentFormData, agentSlug, agentFormReady, agentConnectorList,
  FileForm, type FileFormData, type FileEntry,
  AliasSelector,
  SuccessScreen,
} from './CreateModalForms';
import { useContextFolderTree } from './ContextDestination';
import type { ChannelSectionEntry } from '@/lib/messages/types';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { availableNotePath, composeNotePath, newNoteContent } from '@/lib/notes/shared/newContext';
import { newConnectorNote } from '@/lib/connectors/config';
import { newModelConnectorNote } from '@/lib/connectors/model';
import { newAgentNote } from '@/lib/agents/config';
import { fetchJsonBody } from '@/lib/fetchJson';
import { PROVIDERS } from '@/lib/agents/registry';
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
  const { currentSpace, isAdmin } = useSpace();
  const { reduced } = useSidebar();

  // The "Create new" grid: the registry's grid types, minus any this person
  // can't create here. `inGrid` says which surface lists a type; canCreateType
  // says who may — the sidebar's caret menu asks the same question, so the two
  // entry points can't drift apart (see lib/create/creatable.ts).
  const featureConfig = (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null;
  const gridOptions = TYPE_OPTIONS.filter(
    (o) => o.inGrid && canCreateType(o.id, { featureConfig, isAdmin }),
  );

  // What the current page implies you came here to create, narrowed to the types
  // actually offered in this space (e.g. Channel/Space drop out with channels
  // off, or for non-admins) — and dropped entirely when none survive.
  const routeSuggestion = suggestedCreateType(pathname);
  const suggestedTypes =
    routeSuggestion?.types.filter((t) => gridOptions.some((o) => o.id === t)) ?? [];
  const suggestion =
    routeSuggestion && suggestedTypes.length
      ? { ...routeSuggestion, types: suggestedTypes }
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
  const [channelData, setChannelData] = useState<ChannelFormData>({ name: '', description: '', icon: null, viewMode: 'CHAT', sectionId: '', context: '' });
  const [spaceData, setSpaceData] = useState<SpaceFormData>({ name: '', context: '' });
  const [contextData, setContextData] = useState<ContextFormData>({ title: '', folder: '', tags: '', body: '' });
  const [connectorData, setConnectorData] = useState<ConnectorFormData>({ name: '', description: '', kind: 'http', provider: 'gemini', hosts: '', secretName: '' });
  const [agentData, setAgentData] = useState<AgentFormData>({ name: '', description: '', model: 'gemini/gemma-4-31b-it', connectors: '', web: false, brief: '' });
  const [fileData, setFileData] = useState<FileFormData>({ files: [], folder: '' });
  // Where the just-created note/file lives, so the success screen can offer to
  // open it (null for types that have no viewer to jump to).
  const [createdHref, setCreatedHref] = useState<string | null>(null);
  const [createdDetail, setCreatedDetail] = useState<string | null>(null);
  // Sections for the channel form's "file into section" dropdown, loaded lazily when
  // the Channel form opens.
  const [sections, setSections] = useState<ChannelSectionEntry[]>([]);

  // Folder list + existing note paths for the context forms, loaded (from the
  // shared context cache) only while one of them is open.
  const contextForm = selectedType === 'context' || selectedType === 'file';
  const contextFolderTree = useContextFolderTree(currentSpace?.id ?? null, isOpen && contextForm);
  const contextName = currentSpace?.name ?? 'Context';

  // The note's real destination: the title's slug in the chosen folder, suffixed
  // when that path is already taken, so the preview matches what gets written.
  const contextTitle = contextData.title.trim();
  const contextDestination = useMemo(
    () => availableNotePath(contextData.folder, contextTitle || 'untitled', contextFolderTree.notePaths),
    [contextData.folder, contextTitle, contextFolderTree.notePaths],
  );
  const contextRenamed =
    contextDestination !== composeNotePath(contextData.folder, contextTitle || 'untitled');

  const nameRef = useRef<HTMLInputElement | null>(null);

  // Cross-space finder — one search per addable node type. Inactive types
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
    // Attach the new space node to the SAME canonical identity (if resolved),
    // so adding someone another space already has doesn't create a duplicate.
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

  // Aliases from current space, filtered to the selected node type
  const allAliases = (currentSpace?.aliases as SpaceAlias[] | undefined) ?? [];
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
    setChannelData({ name: '', description: '', icon: null, viewMode: 'CHAT', sectionId: '', context: '' });
    setSpaceData({ name: '', context: '' });
    setContextData({ title: '', folder: '', tags: '', body: '' });
    setConnectorData({ name: '', description: '', kind: 'http', provider: 'gemini', hosts: '', secretName: '' });
    setFileData({ files: [], folder: '' });
    setCreatedHref(null);
    setCreatedDetail(null);
  }, []);

  // Load the space's sections once the Channel form is showing, so the user can
  // file the new channel into one on creation.
  useEffect(() => {
    if (!isOpen || selectedType !== 'channel' || !currentSpace) return;
    let cancelled = false;
    fetch(`/api/messages/sections?spaceId=${encodeURIComponent(currentSpace.id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { sections: [] }))
      .then((payload) => { if (!cancelled) setSections(payload.sections ?? []); })
      .catch(() => { if (!cancelled) setSections([]); });
    return () => { cancelled = true; };
  }, [isOpen, selectedType, currentSpace]);

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

  // `reset` waits out the slide-out so the form doesn't visibly rewind to step 0
  // on its way behind the rail.
  const handleClose = useCallback(() => {
    close();
    setTimeout(reset, DOCK_MS);
  }, [close, reset]);

  useEscapeKey(handleClose, isOpen);

  // Navigating away puts the real sidebar panel back — the create panel is
  // occupying that column, so leaving it open would hide the new page's own list.
  useEffect(() => {
    handleClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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
      if (selectedType === 'channel') return channelData.name.trim().length > 0;
      if (selectedType === 'section') return spaceData.name.trim().length > 0;
      if (selectedType === 'context') return contextTitle.length > 0;
      // Mirrors the server's perimeter validation, so Create can't write a note
      // the connectors layer would immediately call invalid.
      if (selectedType === 'connector') return connectorFormReady(connectorData);
      if (selectedType === 'agent') return agentFormReady(agentData);
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
      if (selectedType === 'channel') {
        // Land the user straight in the new channel — the channels page mounts
        // fresh and picks it up (no success screen needed).
        const id = await createChannel();
        handleClose();
        router.push(`/channels/${encodeURIComponent(id)}`);
      } else if (selectedType === 'section') {
        await createSpace();
        handleClose();
        router.push('/channels');
      } else if (selectedType === 'context') {
        await createContextNote();
        setStep(3);
      } else if (selectedType === 'connector') {
        await createConnectorNote();
        setStep(3);
      } else if (selectedType === 'agent') {
        await createAgentNote();
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
    if (!currentSpace) throw new Error('Select a space first');
    const { conversation } = await fetchJsonBody<{ conversation: { id: string } }>(
      '/api/messages/conversations/channel',
      'POST',
      {
        spaceId: currentSpace.id,
        name: channelData.name.trim(),
        description: channelData.description.trim() || undefined,
        icon: channelData.icon ?? undefined,
        sectionId: channelData.sectionId || undefined,
        viewMode: channelData.viewMode,
        context: channelData.context.trim() || undefined,
      },
    );
    return conversation.id;
  };

  const createSpace = async () => {
    if (!currentSpace) throw new Error('Select a space first');
    await fetchJsonBody('/api/messages/sections', 'POST', {
      spaceId: currentSpace.id,
      name: spaceData.name.trim(),
      context: spaceData.context.trim() || undefined,
    });
  };

  // ── Context note ──────────────────────────────────────────────────────────
  // Writes one note at the previewed path. The folder gate lives server-side
  // (403 with its reason), and intermediate folders come into being with the
  // note, so a brand-new folder name needs no separate create call.
  const createContextNote = async () => {
    if (!currentSpace) throw new Error('Select a space first');
    const path = contextDestination;
    const tags = contextData.tags.split(',').map((t) => t.trim()).filter(Boolean);
    await notesApi.create(
      currentSpace.id,
      path,
      newNoteContent({ title: contextTitle, tags, body: contextData.body }),
    );
    // The tree, the note index and this path's (cached "missing") read all went
    // stale — the sidebar and the note view must see it immediately.
    invalidateContextCache(
      contextKeys.tree(currentSpace.id),
      contextKeys.list(currentSpace.id),
      contextKeys.read(currentSpace.id, path),
    );
    setCreatedHref(noteHref(path));
    setCreatedDetail(`Saved to ${path}`);
  };

  // ── Connector ─────────────────────────────────────────────────────────────
  // A connector is a note whose frontmatter IS its perimeter, so creating one
  // is just writing that note — same path the MCP tools and the describe agent
  // take. The secret's VALUE is deliberately not collected here: it's set on
  // the connector's own page, which is where the success screen points.
  const createConnectorNote = async () => {
    if (!currentSpace) throw new Error('Select a space first');
    const name = connectorSlug(connectorData.name);
    const path = `connectors/${name}.md`;
    const isModel = connectorData.kind === 'model';
    await notesApi.create(
      currentSpace.id,
      path,
      isModel
        ? newModelConnectorNote({
            name,
            provider: connectorData.provider,
            description: connectorData.description.trim(),
          })
        : newConnectorNote({
            name,
            description: connectorData.description.trim(),
            hosts: connectorData.hosts.split('\n').map((l) => l.trim()).filter(Boolean),
            secretName: connectorData.secretName.trim().toUpperCase(),
          }),
    );
    invalidateContextCache(
      contextKeys.tree(currentSpace.id),
      contextKeys.list(currentSpace.id),
      contextKeys.read(currentSpace.id, path),
    );
    setCreatedHref(`/directory/${encodeURIComponent(`connector:${name}`)}`);
    const pendingSecret = isModel
      ? `MODEL_KEY_${connectorData.provider.toUpperCase()}`
      : connectorData.secretName.trim().toUpperCase();
    setCreatedDetail(pendingSecret ? `Saved to ${path} — set ${pendingSecret} on its page to finish.` : `Saved to ${path}`);
  };

  // ── Agent ─────────────────────────────────────────────────────────────────
  // An agent is a note whose frontmatter names its model and reach and whose
  // body is the brief; any member may write it. It does nothing until an
  // admin activates it from /agents — which is where the success screen points.
  const createAgentNote = async () => {
    if (!currentSpace) throw new Error('Select a space first');
    const name = agentSlug(agentData.name);
    const path = `agents/${name}.md`;
    await notesApi.create(
      currentSpace.id,
      path,
      newAgentNote({
        name,
        title: agentData.name.trim(),
        description: agentData.description.trim(),
        model: agentData.model.trim(),
        connectors: agentConnectorList(agentData),
        tools: agentData.web ? ['web'] : [],
        body: agentData.brief.trim(),
      }),
    );
    invalidateContextCache(
      contextKeys.tree(currentSpace.id),
      contextKeys.list(currentSpace.id),
      contextKeys.read(currentSpace.id, path),
    );
    setCreatedHref(`/directory/${encodeURIComponent(`agent:${name}`)}`);
    setCreatedDetail(`Saved to ${path} — a space admin activates it from Agents.`);
  };

  // ── Files (context sources) ───────────────────────────────────────────────
  // Uploaded one at a time: each request runs the whole extract → chunk → embed
  // pipeline synchronously, so a parallel burst would just contend. Per-file
  // status lands on the row; a file that fails leaves the others alone.
  const uploadFiles = async () => {
    if (!currentSpace) throw new Error('Select a space first');
    const spaceId = currentSpace.id;
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
        const { source } = await notesApi.uploadSource(spaceId, entry.file, fileData.folder);
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

    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId));
    const failed = queue.length - uploaded;
    setCreatedHref(uploaded === 1 && lastPath ? sourceHref(lastPath) : '/directory/note/index.md');
    setCreatedDetail(
      `${uploaded} file${uploaded === 1 ? '' : 's'} added to ${fileData.folder || contextName}` +
        (failed ? ` · ${failed} failed` : ''),
    );
  };

  const createNode = async () => {
    if (!currentSpace) throw new Error('Select a space first');

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

    const existing = await fetch(`/api/data/nodes?space_id=${currentSpace.id}`).then(r => r.json());
    const ids = new Set<string>((existing.nodes ?? []).map((n: { id: string }) => n.id));
    let id = baseId;
    let counter = 2;
    while (ids.has(id)) id = `${baseId}-${counter++}`;

    await fetchJsonBody('/api/data/nodes', 'POST', {
      space_id: currentSpace.id,
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
    });

    if (selectedType === 'person') {
      const imageUrl = personData.imageBlob
        ? await uploadCroppedImage('card', id, personData.imageBlob).catch(() => null)
        : personData.imagePreview && !personData.imagePreview.startsWith('blob:')
          ? personData.imagePreview  // auto-filled URL from matched person
          : null;

      if (imageUrl) {
        try {
          await fetch('/api/data/nodes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              space_id: currentSpace.id,
              node: { id, type, name, image_url: imageUrl },
            }),
          });
        } catch {
          // Image failure is non-fatal
        }
      }
    }
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
      : selectedType === 'connector'
      ? connectorSlug(connectorData.name) || 'Connector'
      : selectedType === 'agent'
      ? agentSlug(agentData.name) || 'Agent'
      : selectedType === 'file'
      ? `${uploadedCount} file${uploadedCount === 1 ? '' : 's'}`
      : typeOpt.label
    : '';

  const stepTitles: Record<number, string> = {
    0: 'What are you creating?',
    1: typeOpt ? `New ${typeOpt.label}` : '',
    2: 'Assign a role alias',
    3: '',
  };

  return (
    <>
      {/* Image cropper — a fixed, full-viewport overlay, so it MUST leave the
          sidebar: the rail <aside> keeps a settled `transform`, which would make
          `fixed` resolve against the rail instead of the viewport. */}
      {cropperFile &&
        typeof document !== 'undefined' &&
        createPortal(
          <ImageCropper
            imageFile={cropperFile}
            onCrop={handleCropDone}
            onCancel={() => setCropperFile(null)}
            shape="square"
            outputWidth={400}
            outputHeight={400}
          />,
          document.body,
        )}

      {/* Click-anywhere-to-dismiss catcher: invisible, and under the rail (z-40)
          and navbar (z-50) so the shell's own controls stay live. */}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-30" onClick={handleClose} />,
          document.body,
        )}

      {/* The panel itself: a layer inside the Sidebar's docked column (see
          Sidebar.tsx), sliding out from under the icon rail over whatever panel
          is docked there. Always mounted — `isOpen` drives the transform, and the
          column's overflow-hidden hides it while it's parked off to the left. */}
      <aside
        role="dialog"
        aria-label="Create new"
        aria-hidden={!isOpen}
        className={`absolute inset-0 z-10 flex flex-col overflow-hidden bg-surface-1 ${
          isOpen ? '' : 'pointer-events-none'
        }`}
        // The offset is set inline, NOT with `-translate-x-full`: Tailwind v4
        // compiles translate utilities to the `translate` property, which a
        // `transition: transform` never animates — the panel would jump.
        style={{
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: reduced ? 'none' : `transform ${DOCK_MS}ms ${DOCK_EASE}`,
        }}
      >
          {/* Header */}
          {step < 3 && (
            <div className="flex items-center gap-2 px-4 py-4 border-b border-border-subtle flex-shrink-0">
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
            className={`px-4 py-5 flex-1 overflow-y-auto ${
              step === 3 ? 'flex flex-col justify-center' : ''
            }`}
          >
            {step === 0 && (
              <TypeList options={gridOptions} suggestion={suggestion} onSelect={handleTypeSelect} />
            )}

            {/* Entity steps: form first, then the cross-space finder stacked
                below it — the panel is one sidebar-width column, so the finder
                can't sit beside the form. */}
            {step === 1 && selectedType === 'person' && (
              <div>
                <PersonForm
                  data={personData}
                  onChange={handlePersonChange}
                  nameRef={nameRef}
                  onCropRequest={setCropperFile}
                />
                <div className="mt-5 pt-5 border-t border-border-subtle">
                  <MatchPanel
                    results={personSearch.results}
                    loading={personSearch.loading}
                    onSelect={handleMatchSelect}
                    title="Existing People"
                    emptyHint="Type a name or email to find existing people across spaces."
                    fallbackIcon={PERSON_FINDER_ICON}
                  />
                </div>
              </div>
            )}
            {step === 1 && selectedType === 'resource' && (
              <div>
                <EventForm data={resourceData} onChange={setResourceData} nameRef={nameRef} entityDir="resources" />
                <div className="mt-5 pt-5 border-t border-border-subtle">
                  <MatchPanel
                    results={resourceSearch.results}
                    loading={resourceSearch.loading}
                    onSelect={handleResourceMatch}
                    title="Existing Resources"
                    emptyHint="Type a name to find existing resources across spaces."
                    fallbackIcon={RESOURCE_FINDER_ICON}
                  />
                </div>
              </div>
            )}
            {step === 1 && selectedType === 'event' && (
              <div>
                <EventForm data={eventData} onChange={setEventData} nameRef={nameRef} />
                <div className="mt-5 pt-5 border-t border-border-subtle">
                  <MatchPanel
                    results={eventSearch.results}
                    loading={eventSearch.loading}
                    onSelect={handleEventMatch}
                    title="Existing Events"
                    emptyHint="Type a name to find existing events across spaces."
                    fallbackIcon={EVENT_FINDER_ICON}
                  />
                </div>
              </div>
            )}
            {step === 1 && selectedType === 'channel' && (
              <ChannelForm data={channelData} onChange={setChannelData} nameRef={nameRef} sections={sections} />
            )}
            {step === 1 && selectedType === 'section' && (
              <SpaceForm data={spaceData} onChange={setSpaceData} nameRef={nameRef} />
            )}
            {step === 1 && selectedType === 'context' && (
              <ContextForm
                data={contextData}
                onChange={setContextData}
                nameRef={nameRef}
                folders={contextFolderTree.folders}
                contextName={contextName}
                destination={contextDestination}
                renamed={contextRenamed}
                loading={contextFolderTree.loading}
              />
            )}
            {step === 1 && selectedType === 'connector' && (
              <ConnectorForm data={connectorData} onChange={setConnectorData} nameRef={nameRef} />
            )}
            {step === 1 && selectedType === 'agent' && (
              <AgentForm
                data={agentData}
                onChange={setAgentData}
                nameRef={nameRef}
                models={PROVIDERS.flatMap((p) => p.models.map((m) => ({ value: `${p.id}/${m.id}`, label: `${p.label} — ${m.label}` })))}
              />
            )}
            {step === 1 && selectedType === 'file' && (
              <FileForm
                data={fileData}
                onChange={setFileData}
                folders={contextFolderTree.folders}
                contextName={contextName}
                loading={contextFolderTree.loading}
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
                  createdHref
                    ? selectedType === 'file'
                      ? 'Open'
                      : selectedType === 'connector'
                      ? 'Open connector'
                      : selectedType === 'agent'
                      ? 'Open agent'
                      : 'Open note'
                    : undefined
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
            <div className="px-4 py-4 flex justify-end border-t border-border-subtle flex-shrink-0">
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
      </aside>
    </>
  );
}
