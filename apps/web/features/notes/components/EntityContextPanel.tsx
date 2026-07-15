'use client'

// The profile "Context" tab: the entity's context note (the community's shared
// brain, at its canonical people/<slug>.md / companies/<slug>.md path) in the
// embedded NoteEditor, with the linked-references rail below — the same note the
// Context workspace opens. All reads/writes go through the gated /api/notes
// surface, so the brain gate, folder visibility, and write denials come free.
//
// Viewing never writes: a missing note seeds the editor locally with the entity
// stub and the first real save creates it (PUT /api/notes/item upserts). A read
// that fails for any reason other than a clean 404 disables editing entirely, so
// a transient error can never let the stub clobber an existing note.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { useNodeProfile } from '@/hooks/useNodeProfile'
import { findAlias } from '@/lib/types'
import { getTypeColor } from '@/components/dashboard/typeStyles'
import { hexToPalette } from '@/lib/profileTheme'
import { tagKey, tagPalette } from '@/lib/tagColors'
import { entityNotePath, entityStub, resolveEntityNode } from '@/lib/notes/entities'
import type { NoteMeta, References, RelatedNote } from '@/lib/notes/shared/types'
import { notesApi, type RegistryResponse } from '../lib/notesApi'
import {
  cachedFetch,
  contextKeys,
  invalidateContextCache,
  readNote,
  type NoteRead,
} from '../lib/contextPrefetch'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { NoteEditor } from './NoteEditor'
import { type NoteMode } from './NoteModeToggle'
import { BrainGateCard } from './BrainGateCard'
import { TagCombobox } from './TagCombobox'
import type { PickerEntity } from './NotePicker'
import '../notes.css'

const PERSONAL_ID_PREFIX = 'me:'

// The status-aware note read lives in contextPrefetch (readNote) so profile
// pages can start it before this panel mounts; all reads here go through that
// shared cache and land instantly when the prefetch already ran.

interface EntityContextPanelProps {
  nodeId: string
  // Editor view mode is lifted to the profile page so its Editor/Raw toggle can
  // live in the tab bar; the panel reports whether an editor is on screen so the
  // page knows when to show that toggle.
  mode?: NoteMode
  onModeChange?: (mode: NoteMode) => void
  onEditorActiveChange?: (active: boolean) => void
}

export function EntityContextPanel({
  nodeId,
  mode = 'wysiwyg',
  onModeChange,
  onEditorActiveChange,
}: EntityContextPanelProps) {
  const router = useRouter()
  const { currentCommunity } = useCommunity()
  const communityId = currentCommunity?.id ?? null
  const isPersonalSpace = communityId?.startsWith(PERSONAL_ID_PREFIX) ?? false

  const { data: profileData, loading: nodeLoading } = useNodeProfile(nodeId)
  const node = profileData?.node ?? null
  const { entities, entityByPath, allTags } = useDirectoryEntities()

  const path = node ? entityNotePath({ id: nodeId, type: node.type }) : null

  const [aiConfigured, setAiConfigured] = useState(false)
  const [registry, setRegistry] = useState<RegistryResponse | null>(null)
  // The toolbar and the note text are one visual unit, but they read different
  // fetches: the text needs only the note, while the format controls need
  // `canWrite` (registry) and the Refactor button needs `aiConfigured` (config).
  // Whichever lands second used to pop in after the other. These track "answered"
  // — NOT "answered with a value" — so the panel can hold one skeleton until all
  // of it is in and paint once. A failed fetch resolves them too, or the skeleton
  // would hang forever on the error path (both effects swallow into a null/false).
  const [registryDone, setRegistryDone] = useState(false)
  const [configDone, setConfigDone] = useState(false)
  const [read, setRead] = useState<NoteRead | null>(null)
  const [noteExists, setNoteExists] = useState(false)
  const [notesIndex, setNotesIndex] = useState<NoteMeta[]>([])
  const [references, setReferences] = useState<References | null>(null)
  const [related, setRelated] = useState<RelatedNote[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requestPending, setRequestPending] = useState(false)
  const [requesting, setRequesting] = useState(false)
  // Entity tags shown in the header — seeded from the node, edited in place.
  const [tags, setTags] = useState<string[]>([])
  const [addingTag, setAddingTag] = useState(false)
  const [tagSaving, setTagSaving] = useState(false)
  // Colours registered this session (before the community config refetches).
  const [tagColorOverride, setTagColorOverride] = useState<Record<string, string>>({})
  const loadSeq = useRef(0)

  const gatedOut = !isPersonalSpace && registry !== null && !registry.gate.canRead

  useEffect(() => {
    cachedFetch(contextKeys.config(), () => notesApi.config())
      .then((c) => setAiConfigured(c.aiConfigured))
      .catch(() => {})
      .finally(() => setConfigDone(true))
  }, [])

  useEffect(() => {
    setRegistry(null)
    setRegistryDone(false)
    if (!communityId) return
    let stale = false
    cachedFetch(contextKeys.registry(communityId), () => notesApi.getRegistry(communityId))
      .then((r) => { if (!stale) setRegistry(r) })
      .catch(() => { if (!stale) setRegistry(null) })
      .finally(() => { if (!stale) setRegistryDone(true) })
    return () => { stale = true }
  }, [communityId])

  // When gated out, surface the viewer's own pending root-gate request (same
  // flow as the workspace's gated state).
  useEffect(() => {
    if (!gatedOut || !communityId || !registry) {
      setRequestPending(false)
      return
    }
    notesApi
      .listJoinRequests(communityId)
      .then(({ requests }) =>
        setRequestPending(
          requests.some(
            (r) => r.folderId === '' && r.status === 'pending' && r.userId === registry.me.userId,
          ),
        ),
      )
      .catch(() => setRequestPending(false))
  }, [gatedOut, communityId, registry])

  const requestAccess = async () => {
    if (!communityId) return
    setRequesting(true)
    setError(null)
    try {
      await notesApi.requestJoin(communityId, '')
      setRequestPending(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request access')
    } finally {
      setRequesting(false)
    }
  }

  // Load the note + the brain's note index (for [[ ]] linking, link titles, and
  // the open note's meta) + references/related, best-effort where non-critical.
  useEffect(() => {
    if (!communityId || !path) return
    const seq = ++loadSeq.current
    setRead(null)
    setNoteExists(false)
    setReferences(null)
    setRelated(null)
    onModeChange?.('wysiwyg')
    readNote(communityId, path).then((r) => {
      if (loadSeq.current !== seq) return
      setRead(r)
      setNoteExists(r.status === 'ok')
      if (r.status === 'ok') {
        cachedFetch(contextKeys.references(communityId, path), () =>
          notesApi.references(communityId, path),
        ).then(({ references: refs }) => {
          if (loadSeq.current === seq) setReferences(refs)
        }).catch(() => {})
        cachedFetch(contextKeys.related(communityId, path), () =>
          notesApi.related(communityId, path),
        ).then(({ related: rel }) => {
          if (loadSeq.current === seq) setRelated(rel)
        }).catch(() => {})
      }
    })
    cachedFetch(contextKeys.list(communityId), () => notesApi.list(communityId)).then((l) => {
      if (loadSeq.current === seq) setNotesIndex(l.notes)
    }).catch(() => {})
  }, [communityId, path, onModeChange])

  const noteRefs = useMemo(() => notesIndex.map((n) => ({ path: n.path, title: n.title })), [notesIndex])
  const openMeta = useMemo(() => notesIndex.find((n) => n.path === path) ?? null, [notesIndex, path])

  const stubContent = useMemo(
    () =>
      node
        ? entityStub({ id: nodeId, type: node.type, name: node.name, subtitle: node.subtitle ?? null })
        : '',
    [node, nodeId],
  )

  // Write-permission heuristic for the empty-state copy and editor editability.
  // Server-side writeDenial remains the enforcement; a 403 surfaces in the error
  // row. Personal spaces are always writable; a registered people/companies
  // folder answers directly; unregistered falls back to the root gate.
  const canWrite = useMemo(() => {
    if (isPersonalSpace) return true
    if (!registry) return false
    if (!registry.gate.canRead) return false
    const kindDir = path?.split('/')[0] ?? null
    const folder = kindDir ? registry.folders.find((f) => f.id === kindDir) : null
    return folder ? folder.canWrite : registry.gate.canWrite
  }, [isPersonalSpace, registry, path])

  const handleSave = useCallback(
    async (p: string, body: string, origin?: string) => {
      if (!communityId) return
      try {
        await notesApi.write(communityId, p, body, origin)
        // Drop the prefetch cache's view of this note so a remount re-reads the
        // saved content instead of the pre-save snapshot.
        invalidateContextCache(
          contextKeys.read(communityId, p),
          contextKeys.references(communityId, p),
          contextKeys.related(communityId, p),
          contextKeys.list(communityId),
        )
        setNoteExists(true)
        setError(null)
        cachedFetch(contextKeys.references(communityId, p), () => notesApi.references(communityId, p))
          .then(({ references: refs }) => setReferences(refs)).catch(() => {})
        cachedFetch(contextKeys.related(communityId, p), () => notesApi.related(communityId, p))
          .then(({ related: rel }) => setRelated(rel)).catch(() => {})
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    },
    [communityId],
  )

  // Links inside the note: another entity → that entity's Context tab. Context
  // has no standalone surface anymore, so a link to a non-entity note has
  // nowhere to open — ignore it rather than dead-end on a 404.
  const handleOpenNote = useCallback(
    (p: string) => {
      const targetId = resolveEntityNode(p, entityByPath)
      if (!targetId || targetId === nodeId) return
      router.push(`/directory/${encodeURIComponent(targetId)}?tab=context`)
    },
    [entityByPath, nodeId, router],
  )

  // `[[ ]]` mention picked inside the tab editor: make sure the target entity's
  // note exists before the link lands (same contract as the workspace, minus the
  // post-create personal-copy prompt).
  const ensureEntityNote = useCallback(
    async (entity: PickerEntity): Promise<string> => {
      const p = entityNotePath({ id: entity.id, type: entity.type })
      if (!p) throw new Error('Not a directory entity')
      if (!communityId) throw new Error('No community')
      try {
        await notesApi.create(communityId, p, entityStub(entity))
        // The target entity's note may be cached as "missing" from a prefetch.
        invalidateContextCache(contextKeys.read(communityId, p), contextKeys.list(communityId))
      } catch (err) {
        if (!(err instanceof Error && /already exists/i.test(err.message))) throw err
      }
      return p
    },
    [communityId],
  )

  // Seed the header tags from the node whenever it (re)loads.
  useEffect(() => {
    setTags(node?.tags ?? [])
    setAddingTag(false)
  }, [node?.id, node?.tags])

  // Persist a tag change to the entity's graph node (shared metadata). Optimistic:
  // the header updates immediately and rolls back if the write is rejected.
  const saveTags = useCallback(
    async (next: string[], prev: string[]) => {
      if (!communityId) return
      setTags(next)
      setTagSaving(true)
      try {
        const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ communityId, tags: next }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save tags')
        const { tags: saved } = (await res.json()) as { tags: string[] }
        setTags(saved)
      } catch (err) {
        setTags(prev)
        setError(err instanceof Error ? err.message : 'Failed to save tags')
      } finally {
        setTagSaving(false)
      }
    },
    [communityId, nodeId],
  )

  const addTag = useCallback((raw: string) => {
    const tag = raw.trim()
    if (!tag) return
    if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return
    void saveTags([...tags, tag], tags)
  }, [tags, saveTags])

  // Create a brand-new tag with a chosen colour: register the colour on the
  // community (best-effort — the tag still adds if colour save fails) and add it.
  const createTag = useCallback((raw: string, color: string) => {
    const tag = raw.trim()
    if (!tag || !communityId) return
    setTagColorOverride((m) => ({ ...m, [tagKey(tag)]: color }))
    void fetch(`/api/communities/${encodeURIComponent(communityId)}/tag-colors`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, color }),
    }).catch(() => {})
    addTag(tag)
  }, [communityId, addTag])

  const removeTag = useCallback(
    (tag: string) => { void saveTags(tags.filter((t) => t !== tag), tags) },
    [tags, saveTags],
  )

  // Every answer the editor's first paint depends on: the note itself, the
  // registry behind canWrite (skipped in personal spaces, which are always
  // writable), and the config behind the Refactor button. They're separate
  // requests, so gating the whole surface on all three is what keeps the text,
  // the toolbar and the tags from landing on three different commits.
  const dataReady = read !== null && (isPersonalSpace || registryDone) && configDone

  // Whether a note editor is on screen (mirrors `showEditor` below) — the page
  // shows the Editor/Raw toggle in the tab bar only while it is, so it has to
  // read the same gate or the toggle arrives ahead of the bar it belongs to.
  const editorShown =
    !!node && !!path &&
    !(node?.community_id && node.community_id !== communityId) &&
    !gatedOut &&
    dataReady && read !== null && read.status !== 'error' &&
    (noteExists || canWrite)
  useEffect(() => {
    onEditorActiveChange?.(editorShown)
  }, [editorShown, onEditorActiveChange])
  // Report inactive on unmount (e.g. leaving the Context tab) so a stale toggle
  // doesn't linger in the tab bar.
  useEffect(() => () => onEditorActiveChange?.(false), [onEditorActiveChange])

  // ── Render states ───────────────────────────────────────────────────────────

  if (!communityId || (!node && nodeLoading)) {
    return <PanelSkeleton />
  }
  if (!node || !path) return null

  // The entity note lives in the node's own community brain; a cross-community
  // profile view would write a misbound note — hide the surface instead. (The
  // pages gate the tab on the same condition; this is the backstop.)
  if (node.community_id && node.community_id !== communityId) return null

  if (gatedOut) {
    return (
      <div className="flex justify-center py-10">
        <BrainGateCard
          communityName={currentCommunity?.name ?? 'this community'}
          pending={requestPending}
          requesting={requesting}
          onRequest={requestAccess}
        />
      </div>
    )
  }

  // Hold one skeleton until `dataReady`, so the note text can't beat its own
  // toolbar onto the screen.
  const loadingNote = !dataReady
  const readFailed = read?.status === 'error'
  const showEditor = !loadingNote && !readFailed && (noteExists || canWrite)

  // Alias colour wins over the base type colour (same rule as the profile hero).
  const aliasColor = findAlias(currentCommunity?.communityAliases, node.alias, node.type)?.color
  const theme = hexToPalette(aliasColor ?? getTypeColor(node.type, currentCommunity?.nodeTypes))
  const canEditTags = showEditor && canWrite
  // Community tags not already on this entity power the picker's suggestions.
  const tagsLower = new Set(tags.map((t) => t.toLowerCase()))
  const tagSuggestions = allTags.filter((t) => !tagsLower.has(t.toLowerCase()))
  // Tag colour registry: community-saved colours + those registered this session.
  const tagColors = { ...(currentCommunity?.designConfig?.tagColors ?? {}), ...tagColorOverride }

  // The entity header (avatar, name, type + tag rows). No card chrome — it
  // renders directly on the page so it reads as one surface with the note, and
  // its width/padding mirror .notes-column (760px / 28px) so it lines up with
  // the note text. In the editor state it leads the scrolling content (via
  // NoteEditor's headerSlot), sliding up under the tab bar's attached toolbar;
  // in the other states it renders on the page.
  //
  // Layout mirrors blackbird-brain's context header: a title with real top
  // breathing room, then a labelled "Type" square chip and "Tags" pill row.
  const headerCard = (
    <div className="mx-auto mb-1 w-full max-w-[760px] px-7 pt-10">
      <div className="flex items-center gap-4">
        {/* Only a real image earns the avatar slot — a placeholder silhouette
            would just re-introduce visual chrome the header is shedding. */}
        {node.image_url && (
          <span className="h-20 w-20 flex-none overflow-hidden rounded-xl border border-border-subtle bg-surface-1">
            <img src={node.image_url} alt={node.name} className="h-full w-full object-cover" />
          </span>
        )}
        {/* The name IS the note title here (embedded NoteEditor hides its own
            .notes-title), so it matches that scale: 2.5rem / 600 / tight. */}
        <h2 className="min-w-0 truncate text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.02em] text-text-primary font-open-sauce">{node.name}</h2>
      </div>

      {/* Type row — micro-label above a single solid square chip in the entity's
          alias/type colour (read-only here; the type is owned by the graph). */}
      <div className="mt-5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Type</span>
        <div className="mt-1.5">
          <span className="inline-flex h-7 items-center rounded-md px-2.5 text-[13px] font-semibold text-white"
                style={{ background: theme.base }}>
            {node.alias ?? node.type}
          </span>
        </div>
      </div>

      {(tags.length > 0 || canEditTags) && (
        <div className="mt-4">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Tags</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => {
              const pal = tagPalette(tag, tagColors)
              return (
                <span key={tag}
                      className="inline-flex h-7 items-center gap-1 rounded-full pl-3 pr-1.5 text-[13px] font-medium text-white"
                      style={{ background: pal.base }}>
                  <span className="truncate">{tag}</span>
                  {canEditTags && (
                    <button type="button" onClick={() => removeTag(tag)} disabled={tagSaving}
                            aria-label={`Remove ${tag}`}
                            className="rounded-full p-0.5 opacity-60 transition hover:opacity-100 disabled:opacity-30">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              )
            })}

            {canEditTags && (addingTag ? (
              <TagCombobox
                suggestions={tagSuggestions}
                existing={tagsLower}
                registry={tagColors}
                accentBase={theme.base}
                onAdd={addTag}
                onCreate={createTag}
                onClose={() => setAddingTag(false)}
              />
            ) : (
              <button type="button" onClick={() => setAddingTag(true)} disabled={tagSaving}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border-default px-3 text-[13px] font-medium text-text-muted transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:opacity-40"
                      style={{ ['--accent' as string]: theme.dark }}>
              + Add tag
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="pb-10">
      {/* Header renders here only outside the editor state; in the editor it
          rides NoteEditor's headerSlot, just under the sticky toolbar. */}
      {!showEditor && headerCard}

      {error && (
        <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {loadingNote ? (
        <PanelSkeleton />
      ) : readFailed ? (
        <div className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">
          {read.message}
        </div>
      ) : showEditor ? (
        <>
          {!noteExists && (
            <p className="mx-auto mb-4 max-w-3xl text-center text-sm text-text-muted">
              No shared context for {node.name} yet — start typing below to create it.
            </p>
          )}
          <NoteEditor
            key={path}
            variant="embedded"
            headerSlot={headerCard}
            path={path}
            meta={openMeta}
            notes={noteRefs}
            initialContent={read.status === 'ok' ? read.content : stubContent}
            canEdit={canWrite}
            aiConfigured={aiConfigured}
            mode={mode}
            references={references}
            related={related}
            entities={entities}
            entityByPath={entityByPath}
            onEnsureEntityNote={ensureEntityNote}
            onSave={handleSave}
            onOpenNote={handleOpenNote}
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-base font-semibold text-text-secondary">No shared context for {node.name} yet.</p>
          <p className="text-sm text-text-muted">Members with write access can start this entity&apos;s context note.</p>
        </div>
      )}
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse space-y-3 py-6">
      <div className="h-4 w-2/3 rounded bg-surface-2" />
      <div className="h-4 w-full rounded bg-surface-2" />
      <div className="h-4 w-5/6 rounded bg-surface-2" />
      <div className="h-4 w-1/2 rounded bg-surface-2" />
    </div>
  )
}
