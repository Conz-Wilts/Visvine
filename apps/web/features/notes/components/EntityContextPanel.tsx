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
import { Radio } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { CHIP_ACCENT_HOVER, Chip, chipClass } from '@/components/ui'
import { useCommunity } from '@/features/shared/contexts/CommunityContext'
import { useNodeProfile, patchCachedNodeProfile } from '@/features/shared/hooks/useNodeProfile'
import { findAlias, nodeTypeLabel } from '@/lib/types'
import { getTypeColor } from '@/features/directory/components/typeStyles'
import { hexToPalette } from '@/lib/profileTheme'
import { tagKey, tagPalette } from '@/lib/tagColors'
import { entityNotePath, entityStub, noteHref, resolveEntityNode } from '@/lib/notes/entities'
import type { NoteMeta, References, RestrictedReference, UnlinkedReference } from '@/lib/notes/shared/types'
import { notesApi, type PathAccessResponse, type PublicationStateResponse } from '../lib/notesApi'
import {
  cachedFetch,
  contextKeys,
  invalidateContextCache,
  readNote,
  swrFetch,
  type NoteRead,
} from '../lib/contextPrefetch'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { NoteEditor } from './NoteEditor'
import { type NoteMode } from './NoteModeToggle'
import { AccessRequestCard } from './AccessRequestCard'
import { useShareAction } from './useShareAction'
import { SharePanel } from './SharePanel'
import { TagCombobox } from './TagCombobox'
import { PropertyRows } from './PropertyRows'
import type { PickerEntity } from './NotePicker'
import '../notes.css'

const PERSONAL_ID_PREFIX = 'me:'

// The status-aware note read lives in contextPrefetch (readNote) so profile
// pages can start it before this panel mounts; all reads here go through that
// shared cache and land instantly when the prefetch already ran.

interface EntityContextPanelProps {
  nodeId: string
  // Editor view mode is lifted to the profile page (reset there across tab
  // switches); the editor's own toolbar hosts the Editor/Raw toggle.
  mode?: NoteMode
  onModeChange?: (mode: NoteMode) => void
  /** Fired once this panel has stopped waiting on data and is rendering its real
   *  surface — the profile page holds its entrance animation until then, so the
   *  transition into a note plays over the note instead of over a skeleton. */
  onReady?: () => void
}

export function EntityContextPanel({
  nodeId,
  mode = 'wysiwyg',
  onModeChange,
  onReady,
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
  const [access, setAccess] = useState<PathAccessResponse | null>(null)
  // The toolbar and the note text are one visual unit, but they read different
  // fetches: the text needs only the note, while the format controls need
  // `canWrite` (per-path access) and the Refactor button needs `aiConfigured`
  // (config). Whichever lands second used to pop in after the other. These track
  // "answered" — NOT "answered with a value" — so the panel can hold one skeleton
  // until all of it is in and paint once. A failed fetch resolves them too, or
  // the skeleton would hang forever on the error path (both effects swallow into
  // a null/false).
  // Which note each answer is FOR, rather than a bare "answered" flag — on a switch
  // the panel has to tell "answered for the note being left" apart from "answered
  // for the note being opened". See `shown`.
  const [accessPath, setAccessPath] = useState<string | null>(null)
  const [configDone, setConfigDone] = useState(false)
  // The note currently ON SCREEN, which lags `path` while the next one loads rather
  // than being cleared. NoteEditor portals its format toolbar up into the tab bar
  // (TabBarSlotContext), so tearing the editor down for the length of a fetch
  // empties that bar and refills it after — the toolbar flash on every switch.
  // Holding the previous note keeps the toolbar mounted, and the new read swaps
  // editor and toolbar together on one commit via `key={shown.path}`. The body is
  // hidden while it lags (ContentReveal), so the outgoing note is never seen.
  // Scoped by community as well as path: the same path in two brains is two
  // different notes, so a community switch must not reuse a held read.
  const [shown, setShown] = useState<{ communityId: string; path: string; read: NoteRead } | null>(null)
  const [everPainted, setEverPainted] = useState(false)
  const [noteExists, setNoteExists] = useState(false)
  const [notesIndex, setNotesIndex] = useState<NoteMeta[]>([])
  const [references, setReferences] = useState<References | null>(null)
  const [pubs, setPubs] = useState<PublicationStateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requestPending, setRequestPending] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  // Share rides the tab row beside Connections. Called up here with the other
  // hooks: the render below returns early on several states.
  const share = useShareAction({ onOpen: () => setShareOpen(true), title: 'Who can see this context?' })
  // Entity tags shown in the header — seeded from the node, edited in place.
  const [tags, setTags] = useState<string[]>([])
  // Rename: the saved local title override (survives the hook's stale cache),
  // the in-progress edit buffer (null = not editing), and the save flag.
  const [nameOverride, setNameOverride] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [nameSaving, setNameSaving] = useState(false)
  const [addingTag, setAddingTag] = useState(false)
  const [tagSaving, setTagSaving] = useState(false)
  // Colours registered this session (before the community config refetches).
  const [tagColorOverride, setTagColorOverride] = useState<Record<string, string>>({})
  const loadSeq = useRef(0)

  const gatedOut = !isPersonalSpace && access !== null && access.gated
  // Inside the brain but cut off from THIS entity's note (a restricted folder
  // between them and it). canRead is path-based, not existence-based, so this
  // never fires for an entity that simply has no note yet — that case keeps its
  // "no context yet" empty state.
  const deniedPath = !isPersonalSpace && access !== null && !access.gated && !access.canRead

  // swrFetch delivers a cached value synchronously, so on a re-open these
  // "done" gates flip in the same render pass and the skeleton never flashes.
  useEffect(() => {
    swrFetch(contextKeys.config(), () => notesApi.config(), (c) => {
      setAiConfigured(c.aiConfigured)
      setConfigDone(true)
    }).catch(() => setConfigDone(true))
  }, [])

  // Access is held across a switch for the same reason `shown` is: canWrite gates
  // the toolbar's format controls, so clearing it would blank those buttons even
  // with the editor still mounted — the same flash by another route.
  useEffect(() => {
    if (!communityId || !path) return
    let stale = false
    swrFetch(
      contextKeys.access(communityId, path),
      () => notesApi.getAccess(communityId, path),
      (a) => {
        if (stale) return
        setAccess(a)
        setAccessPath(path)
      },
    ).catch(() => {
      if (!stale) {
        setAccess(null)
        setAccessPath(path)
      }
    })
    return () => { stale = true }
  }, [communityId, path])

  // Surface the viewer's own open request for whatever denied them: the root
  // gate ('') when the brain is closed to them, else this entity's note path
  // (same flow as the workspace's gated state).
  const requestPath = gatedOut ? '' : (path ?? '')
  useEffect(() => {
    if (!communityId || isPersonalSpace || !access) {
      setRequestPending(false)
      return
    }
    let stale = false
    notesApi
      .listAccessRequests(communityId)
      .then(({ requests }) => {
        if (stale) return
        setRequestPending(
          requests.some(
            (r) => r.resourcePath === requestPath && r.status === 'pending' && r.userId === access.me.userId,
          ),
        )
      })
      .catch(() => {
        if (!stale) setRequestPending(false)
      })
    return () => { stale = true }
  }, [communityId, isPersonalSpace, requestPath, access])

  const requestAccess = async (message?: string) => {
    if (!communityId) return
    setRequesting(true)
    setError(null)
    try {
      await notesApi.requestAccess(communityId, requestPath, message)
      setRequestPending(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request access')
    } finally {
      setRequesting(false)
    }
  }

  // Load the note + the brain's note index (for [[ ]] linking, link titles, and
  // the open note's meta) + references, best-effort where non-critical.
  useEffect(() => {
    if (!communityId || !path) return
    const seq = ++loadSeq.current
    // No setShown(null) here — that teardown is what blanks the toolbar. The
    // previous note stays mounted until this read lands. noteExists isn't reset
    // either: it gates showEditor, so clearing it would unmount the editor (and
    // its toolbar) for read-only viewers even while `shown` holds. The read handler
    // below sets it in the same commit that swaps `shown`.
    setReferences(null)
    setPubs(null)
    onModeChange?.('wysiwyg')
    // References fire in parallel with the read (no waterfall — they're
    // below-the-fold UI); their results only apply once the read lands 'ok', so
    // a missing note never shows phantom backlinks.
    const refsPromise = cachedFetch(contextKeys.references(communityId, path), () =>
      notesApi.references(communityId, path),
    )
    readNote(communityId, path).then((r) => {
      if (loadSeq.current !== seq) return
      setShown({ communityId, path, read: r })
      setNoteExists(r.status === 'ok')
      if (r.status === 'ok') {
        refsPromise.then(({ references: refs }) => {
          if (loadSeq.current === seq) setReferences(refs)
        }).catch(() => {})
        // Replica banner: is this context note a live published copy?
        notesApi.getPublications(communityId, path).then((state) => {
          if (loadSeq.current === seq) setPubs(state)
        }).catch(() => {})
      }
    })
    refsPromise.catch(() => {}) // avoid unhandled rejection when the read isn't 'ok'
    swrFetch(contextKeys.list(communityId), () => notesApi.list(communityId), (l) => {
      if (loadSeq.current === seq) setNotesIndex(l.notes)
    }).catch(() => {})
  }, [communityId, path, onModeChange])

  const noteRefs = useMemo(() => notesIndex.map((n) => ({ path: n.path, title: n.title })), [notesIndex])
  // Keyed to the note on screen, not the one being fetched — while `shown` lags,
  // its meta must stay its own.
  const shownPath = shown?.path ?? null
  const openMeta = useMemo(
    () => notesIndex.find((n) => n.path === shownPath) ?? null,
    [notesIndex, shownPath],
  )

  const stubContent = useMemo(
    () =>
      node
        ? entityStub({ id: nodeId, type: node.type, name: node.name, subtitle: node.subtitle ?? null })
        : '',
    [node, nodeId],
  )

  // Editor editability: server-computed per-path access (any-depth grants and
  // restricted cuts included) — writeDenial stays the enforcement; a 403
  // surfaces in the error row. Personal spaces are always writable. A live
  // published replica is read-only here regardless of folder access.
  const isReplica = pubs?.asTarget != null
  const canWrite = (isPersonalSpace || (access?.canWrite ?? false)) && !isReplica

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
          contextKeys.list(communityId),
          contextKeys.tree(communityId), // a first save creates the note — the tree gains it
        )
        setNoteExists(true)
        setError(null)
        cachedFetch(contextKeys.references(communityId, p), () => notesApi.references(communityId, p))
          .then(({ references: refs }) => setReferences(refs)).catch(() => {})
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    },
    [communityId],
  )

  // Turn one unlinked reference into a real link. The write lands on the SOURCE
  // note, so its caches are the ones to drop; the route hands back this note's
  // refreshed references. Errors bubble to the reference's own inline slot.
  const handleLinkMention = useCallback(
    async (ref: UnlinkedReference) => {
      if (!communityId || !path) return
      const { references: refs } = await notesApi.linkMention(
        communityId,
        path,
        ref.fromPath,
        ref.offset,
      )
      setReferences(refs)
      invalidateContextCache(
        contextKeys.read(communityId, ref.fromPath),
        contextKeys.references(communityId, ref.fromPath),
        contextKeys.references(communityId, path),
        contextKeys.list(communityId),
      )
    },
    [communityId, path],
  )

  // "Get access" on a locked reference stub: file a request for the hidden
  // source note behind it (the stub's token stands in for its path). The
  // references cache is dropped so a refetch reports the stub as pending.
  const handleRequestReferenceAccess = useCallback(
    async (ref: RestrictedReference) => {
      if (!communityId || !path) return
      await notesApi.requestReferenceAccess(communityId, path, ref.token)
      invalidateContextCache(contextKeys.references(communityId, path))
    },
    [communityId, path],
  )

  // Links inside the note: another entity → that entity's Context tab; a
  // non-entity note (folder index, sector, deal…) → the standalone note view.
  const handleOpenNote = useCallback(
    (p: string) => {
      const targetId = resolveEntityNode(p, entityByPath)
      if (targetId === nodeId) return
      if (targetId) router.push(`/directory/${encodeURIComponent(targetId)}?tab=context`)
      else router.push(noteHref(p))
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
      if (!communityId) throw new Error('No space')
      try {
        await notesApi.create(communityId, p, entityStub(entity))
        // The target entity's note may be cached as "missing" from a prefetch.
        invalidateContextCache(
          contextKeys.read(communityId, p),
          contextKeys.list(communityId),
          contextKeys.tree(communityId),
        )
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

  // A different node means a different title: drop any rename state.
  useEffect(() => {
    setNameOverride(null)
    setNameDraft(null)
  }, [node?.id])

  // Persist a rename. The header updates immediately (override), the profile
  // cache is patched so other surfaces pick it up, and a rejected write rolls
  // the title back.
  const saveName = useCallback(
    async (raw: string, prevName: string) => {
      const next = raw.trim()
      setNameDraft(null)
      if (!next || next === prevName || !communityId) return
      setNameOverride(next)
      setNameSaving(true)
      try {
        const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ communityId, name: next }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to rename')
        patchCachedNodeProfile(nodeId, { name: next })
      } catch (err) {
        setNameOverride(null)
        setError(err instanceof Error ? err.message : 'Failed to rename')
      } finally {
        setNameSaving(false)
      }
    },
    [communityId, nodeId],
  )

  // Persist a tag change to the entity's context node (shared metadata). Optimistic:
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
  // per-path access behind canWrite (skipped in personal spaces, which are
  // always writable), and the config behind the Refactor button. They're
  // separate requests, so gating the whole surface on all three is what keeps
  // the text, the toolbar and the tags from landing on three different commits.
  // Everything answered FOR THE PATH BEING OPENED. `shown` may still be the note
  // being left when this is false; that lag is what keeps the toolbar up.
  const shownFresh = shown?.path === path && shown?.communityId === communityId
  const dataReady = shownFresh && (isPersonalSpace || accessPath === path) && configDone

  // "Nothing left to wait for": the note being opened has landed, or we've reached
  // a terminal branch that renders its own final surface (gated/denied, or a node
  // this panel declines to render at all). The page holds its reveal until this
  // flips, so the animation plays over the note.
  const revealReady =
    !!communityId &&
    !(!node && nodeLoading) &&
    (!node || !path || gatedOut || deniedPath || dataReady)
  useEffect(() => {
    if (revealReady) onReady?.()
  }, [revealReady, onReady])

  // Latched: once a note has painted, the panel never drops back to a skeleton —
  // it keeps showing the note it has until the next one is ready to replace it.
  useEffect(() => {
    if (dataReady) setEverPainted(true)
  }, [dataReady])

  // ── Render states ───────────────────────────────────────────────────────────

  if (!communityId || (!node && nodeLoading)) {
    return <PanelSkeleton />
  }
  if (!node || !path) return null

  // The entity note lives in the node's own community brain; a cross-community
  // profile view would write a misbound note — hide the surface instead. (The
  // pages gate the tab on the same condition; this is the backstop.)
  if (node.community_id && node.community_id !== communityId) return null

  if (gatedOut || deniedPath) {
    return (
      <div className="flex justify-center py-10">
        <AccessRequestCard
          scope={gatedOut ? 'brain' : 'path'}
          communityName={currentCommunity?.name ?? 'this space'}
          pending={requestPending}
          requesting={requesting}
          error={error}
          onRequest={requestAccess}
        />
      </div>
    )
  }

  // First load holds one skeleton so the note text can't beat its own toolbar onto
  // the screen. After that the panel always has a note to show: it keeps the held
  // one rather than flashing a skeleton between two notes.
  const loadingNote = !shown || (!dataReady && !everPainted)
  const shownRead = shown?.read ?? null
  const readFailed = shownRead?.status === 'error'
  const showEditor = !loadingNote && !readFailed && (noteExists || canWrite)

  // Alias colour wins over the base type colour (same rule as the profile hero).
  const aliasColor = findAlias(currentCommunity?.communityAliases, node.alias, node.type)?.color
  const theme = hexToPalette(aliasColor ?? getTypeColor(node.type, currentCommunity?.nodeTypes))
  // Tags are node metadata, edited by whoever can write the entity's context.
  // They stay editable during a save (an in-flight PATCH must not yank the row
  // out from under the cursor).
  const canEditTags = showEditor && canWrite
  // The title actually on screen: a just-saved rename wins over the hook's
  // cached node until the next real fetch.
  const displayName = nameOverride ?? node.name
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
            .notes-title), so it matches that scale: 2.5rem / 600 / tight.
            `truncate` clips overflow, and leading-[1.1] makes the line box
            shorter than the font's ascent+descent — without the pb the p/g/y
            descenders get shaved off. Anyone who can write the note can rename
            the entity — the id and note path are minted once, so the title is
            pure display metadata (server: PATCH /api/nodes name). */}
        {nameDraft !== null ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void saveName(nameDraft, displayName)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveName(nameDraft, displayName)
              if (e.key === 'Escape') setNameDraft(null)
            }}
            aria-label="Entity name"
            className="min-w-0 flex-1 rounded-md bg-transparent pb-1 text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.02em] text-text-primary outline-none ring-1 ring-border-default font-open-sauce"
          />
        ) : (
          <h2
            onClick={canEditTags && !nameSaving ? () => setNameDraft(displayName) : undefined}
            title={canEditTags ? 'Click to rename' : undefined}
            className={`min-w-0 flex-1 truncate pb-1 text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.02em] text-text-primary font-open-sauce${canEditTags ? ' cursor-text rounded-md transition hover:bg-surface-2' : ''}`}
          >
            {displayName}
          </h2>
        )}
        {!showEditor && share.fallback}
      </div>

      {isReplica && pubs?.asTarget && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-secondary">
          <Radio className="h-4 w-4 shrink-0 text-brand-green" />
          <span>
            Published from <span className="font-medium">{pubs.asTarget.sourceCommunityName}</span> — kept in
            sync with its source, read-only here. Unlink it from Share to make it an editable copy.
          </span>
        </div>
      )}

      {/* Type then Tags — nothing else. A committed entity's context header is
          deliberately thinner than the create surface's: the type's own fields
          (role, website, HQ…) live on the profile's details section, and every
          entity reads the same here no matter how many fields its type defines.
          `type={null}` is what withholds those rows from PropertyRows; the Type
          chip stays read-only because retyping a committed entity moves its note
          and rebinds its identity — a migration, not a field edit. */}
      <PropertyRows
        type={null}
        values={{}}
        accent={theme.dark}
        typeRow={
          <Chip size="lg" color={theme.base}>
            {nodeTypeLabel(node.type, node.alias, currentCommunity?.communityAliases, currentCommunity?.nodeTypes)}
          </Chip>
        }
        tagsRow={(tags.length > 0 || canEditTags) ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <Chip key={tag} size="lg" color={tagPalette(tag, tagColors).base}
                    removeDisabled={tagSaving}
                    onRemove={canEditTags ? () => removeTag(tag) : undefined}
                    removeLabel={`Remove ${tag}`}>
                {tag}
              </Chip>
            ))}

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
                      className={chipClass({ tone: 'dashed', size: 'lg', className: CHIP_ACCENT_HOVER })}
                      style={{ ['--accent' as string]: theme.dark }}>
              + Add tag
            </button>
          ))}
          </div>
        ) : null}
      />

      {/* The member link a person context can carry lives on its Profile tab,
          not here — it's a relation, not node metadata. */}
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
          {shownRead.status === 'error' ? shownRead.message : null}
        </div>
      ) : showEditor ? (
        <>
          {!noteExists && (
            <p className="mx-auto mb-4 max-w-3xl text-center text-sm text-text-muted">
              No shared context for {displayName} yet — start typing below to create it.
            </p>
          )}
          {/* Keyed and fed from `shown`, never from the in-flight `path`: the editor
              is the note it actually holds. When the next read lands, this key
              changes and React swaps the editor — and the toolbar it portals into
              the tab bar — on a single commit, with no empty frame between. */}
          <NoteEditor
            key={shown?.path ?? path}
            variant="embedded"
            headerSlot={headerCard}
            toolbarTrailSlot={share.fallback}
            path={shown?.path ?? path}
            meta={openMeta}
            notes={noteRefs}
            initialContent={shownRead?.status === 'ok' ? shownRead.content : stubContent}
            canEdit={canWrite}
            aiConfigured={aiConfigured}
            mode={mode}
            onModeChange={onModeChange}
            references={shownFresh ? references : null}
            showUnlinked={false}
            entities={entities}
            entityByPath={entityByPath}
            onEnsureEntityNote={ensureEntityNote}
            onSave={handleSave}
            onOpenNote={handleOpenNote}
            onLinkMention={handleLinkMention}
            onRequestReferenceAccess={isPersonalSpace ? undefined : handleRequestReferenceAccess}
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-base font-semibold text-text-secondary">No shared context for {node.name} yet.</p>
          <p className="text-sm text-text-muted">Members with write access can start this entity&apos;s context note.</p>
        </div>
      )}
      {share.slot}
      {shareOpen && path && communityId && (
        <SharePanel
          communityId={communityId}
          path={path}
          kind="note"
          onClose={() => setShareOpen(false)}
        />
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
