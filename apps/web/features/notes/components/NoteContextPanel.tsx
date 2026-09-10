'use client'

// The standalone note view (/directory/note/<path>): any non-entity context note —
// folder indexes, sectors, deals, journal pages — in the embedded NoteEditor with
// the linked-references rail below. The slim sibling of EntityContextPanel: same
// gated /api/notes pipeline (context gate, grant-based visibility and write denials
// come free), minus everything entity-specific (node profile, tags header, stub
// creation). A missing note here is just "not found" — this surface never creates.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BlocksIcon, RadioIcon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { entityNotePath, entityStub, hrefForNotePath, noteHref } from '@/lib/notes/entities'
import type { NoteMeta, References, RestrictedReference, UnlinkedReference } from '@/lib/notes/shared/types'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
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
import { NoteMetaRows } from './NoteMetaRows'
import { type NoteMode } from './NoteModeToggle'
import { AccessRequestCard } from './AccessRequestCard'
import { useShareAction } from './useShareAction'
import { SharePanel } from './SharePanel'
import type { PickerEntity } from './NotePicker'
import type { SpaceAlias } from '@/lib/types'
import '../notes.css'

const PERSONAL_ID_PREFIX = 'me:'

interface NoteContextPanelProps {
  path: string
  mode?: NoteMode
  onModeChange?: (mode: NoteMode) => void
  /** Fired once this panel has stopped waiting on data and is rendering its real
   *  surface. The page holds its entrance animation until then (ContentReveal), so
   *  the transition into a note plays over the note and not over a skeleton. */
  onReady?: () => void
}

export function NoteContextPanel({ path, mode = 'wysiwyg', onModeChange, onReady }: NoteContextPanelProps) {
  const router = useRouter()
  const { currentSpace } = useSpace()
  const spaceId = currentSpace?.id ?? null
  const isPersonalSpace = spaceId?.startsWith(PERSONAL_ID_PREFIX) ?? false
  const { entities, entityByPath } = useDirectoryEntities()

  const [aiConfigured, setAiConfigured] = useState(false)
  const [access, setAccess] = useState<PathAccessResponse | null>(null)
  // Which note each answer is FOR, rather than a bare "answered" flag. The panel
  // still holds one skeleton until note + access + config are all in on first
  // load (same paint-once contract as EntityContextPanel), but on a switch it
  // needs to distinguish "answered for the note being left" from "answered for
  // the note being opened" — see `shown`.
  const [accessPath, setAccessPath] = useState<string | null>(null)
  const [configDone, setConfigDone] = useState(false)
  // The note currently ON SCREEN. It deliberately lags `path` while the next note
  // loads instead of being cleared: NoteEditor portals its format toolbar up into
  // the tab bar (TabBarSlotContext), so dropping to a skeleton unmounts the editor,
  // which empties the bar for the length of the fetch and refills it afterwards —
  // the toolbar flash on every note switch. Holding the previous note keeps that
  // toolbar mounted throughout, and when the new read lands `key={shown.path}`
  // replaces editor and toolbar together on a single commit, so there is never an
  // empty frame. The body itself is hidden while it lags (ContentReveal), so the
  // outgoing note is never actually seen under the incoming note's title.
  // Scoped by space as well as path: the same path in two contexts is two
  // different notes, so a space switch must not be able to reuse a held read.
  const [shown, setShown] = useState<{ spaceId: string; path: string; read: NoteRead } | null>(null)
  const [everPainted, setEverPainted] = useState(false)
  const [notesIndex, setNotesIndex] = useState<NoteMeta[]>([])
  const [references, setReferences] = useState<References | null>(null)
  const [pubs, setPubs] = useState<PublicationStateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requestPending, setRequestPending] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  // Share rides the tab row beside Connections — every note answers "who sees
  // this" from the same spot the entity Context tab does. Called up here with
  // the other hooks: the render below returns early on several states.
  const share = useShareAction({ onOpen: () => setShareOpen(true), title: 'Who can see this?' })
  const loadSeq = useRef(0)

  const gatedOut = !isPersonalSpace && access !== null && access.gated

  // swrFetch delivers a cached value synchronously, so on a re-open these
  // "done" gates flip in the same render pass and the skeleton never flashes.
  useEffect(() => {
    swrFetch(contextKeys.config(), () => notesApi.config(), (c) => {
      setAiConfigured(c.aiConfigured)
      setConfigDone(true)
    }).catch(() => setConfigDone(true))
  }, [])

  // Access is held across a note switch for the same reason `shown` is: canWrite
  // gates the toolbar's format controls, so clearing it mid-switch would blank
  // those buttons even with the editor still mounted — the same flash by another
  // route. accessPath records which note the held answer belongs to.
  useEffect(() => {
    if (!spaceId || !path) return
    let stale = false
    swrFetch(
      contextKeys.access(spaceId, path),
      () => notesApi.getAccess(spaceId, path),
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
  }, [spaceId, path])

  // Surface the viewer's own open request for whichever resource denied them —
  // the root gate ('') when gated out of the context, else this exact note path.
  const requestPath = gatedOut ? '' : path
  useEffect(() => {
    if (!spaceId || isPersonalSpace) {
      setRequestPending(false)
      return
    }
    let stale = false
    notesApi
      .listAccessRequests(spaceId)
      .then(({ requests }) => {
        if (stale) return
        setRequestPending(
          requests.some(
            (r) => r.resourcePath === requestPath && r.status === 'pending' && r.userId === access?.me.userId,
          ),
        )
      })
      .catch(() => {
        if (!stale) setRequestPending(false)
      })
    return () => { stale = true }
  }, [spaceId, isPersonalSpace, requestPath, access?.me.userId])

  const requestAccess = async (message?: string) => {
    if (!spaceId) return
    setRequesting(true)
    setError(null)
    try {
      await notesApi.requestAccess(spaceId, requestPath, message)
      setRequestPending(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request access')
    } finally {
      setRequesting(false)
    }
  }

  // Load the note + the context's note index + references.
  useEffect(() => {
    if (!spaceId || !path) return
    const seq = ++loadSeq.current
    // No setShown(null) here — that is exactly the teardown that blanks the
    // toolbar. The previous note stays mounted until this read lands.
    setReferences(null)
    setPubs(null)
    onModeChange?.('wysiwyg')
    // References fire in parallel with the read (no waterfall); their
    // results only apply once the read lands 'ok' — same as EntityContextPanel.
    const refsPromise = cachedFetch(contextKeys.references(spaceId, path), () =>
      notesApi.references(spaceId, path),
    )
    readNote(spaceId, path).then((r) => {
      if (loadSeq.current !== seq) return
      setShown({ spaceId, path, read: r })
      if (r.status === 'ok') {
        refsPromise.then(({ references: refs }) => {
          if (loadSeq.current === seq) setReferences(refs)
        }).catch(() => {})
        // Replica banner: is this note a live published copy?
        swrFetch(contextKeys.publications(spaceId, path), () => notesApi.getPublications(spaceId, path), (state) => {
          if (loadSeq.current === seq) setPubs(state)
        }).catch(() => {})
      }
    })
    refsPromise.catch(() => {}) // avoid unhandled rejection when the read isn't 'ok'
    swrFetch(contextKeys.list(spaceId), () => notesApi.list(spaceId), (l) => {
      if (loadSeq.current === seq) setNotesIndex(l.notes)
    }).catch(() => {})
  }, [spaceId, path, onModeChange])

  const noteRefs = useMemo(() => notesIndex.map((n) => ({ path: n.path, title: n.title })), [notesIndex])
  // Keyed to the note on screen, not the one being fetched — while `shown` lags,
  // its title/meta must stay its own.
  const shownPath = shown?.path ?? null
  const openMeta = useMemo(
    () => notesIndex.find((n) => n.path === shownPath) ?? null,
    [notesIndex, shownPath],
  )

  // Server-computed, per-path (any-depth grants + restricted cuts included).
  // A live published replica is read-only here regardless of folder access.
  const isReplica = pubs?.asTarget != null
  const canWrite = (isPersonalSpace || (access?.canWrite ?? false)) && !isReplica

  const handleSave = useCallback(
    async (p: string, body: string, origin?: string) => {
      if (!spaceId) return
      try {
        const { movedTo } = await notesApi.write(spaceId, p, body, origin)
        invalidateContextCache(
          contextKeys.read(spaceId, p),
          contextKeys.references(spaceId, p),
          contextKeys.list(spaceId),
          contextKeys.tree(spaceId), // a save can create the note — the tree gains it
        )
        setError(null)
        // Retyping to `Index` made this note a folder and moved it there — the
        // path in the URL no longer exists, so follow it.
        if (movedTo) {
          invalidateContextCache(contextKeys.read(spaceId, movedTo))
          router.replace(noteHref(movedTo))
          return
        }
        cachedFetch(contextKeys.references(spaceId, p), () => notesApi.references(spaceId, p))
          .then(({ references: refs }) => setReferences(refs)).catch(() => {})
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    },
    [spaceId, router],
  )

  // Turn one unlinked reference into a real link. The write lands on the SOURCE
  // note, so its caches are the ones to drop; the route hands back this note's
  // refreshed references. Errors bubble to the reference's own inline slot.
  const handleLinkMention = useCallback(
    async (ref: UnlinkedReference) => {
      if (!spaceId || !path) return
      const { references: refs } = await notesApi.linkMention(
        spaceId,
        path,
        ref.fromPath,
        ref.offset,
      )
      setReferences(refs)
      invalidateContextCache(
        contextKeys.read(spaceId, ref.fromPath),
        contextKeys.references(spaceId, ref.fromPath),
        contextKeys.references(spaceId, path),
        contextKeys.list(spaceId),
      )
    },
    [spaceId, path],
  )

  // "Get access" on a locked reference stub: file a request for the hidden
  // source note behind it (the stub's token stands in for its path). The
  // references cache is dropped so a refetch reports the stub as pending.
  const handleRequestReferenceAccess = useCallback(
    async (ref: RestrictedReference) => {
      if (!spaceId || !path) return
      await notesApi.requestReferenceAccess(spaceId, path, ref.token)
      invalidateContextCache(contextKeys.references(spaceId, path))
    },
    [spaceId, path],
  )

  // Links inside the note: entity (or one of its sub-notes) → its profile
  // Context tab; anything else → its own note view.
  const handleOpenNote = useCallback(
    (p: string) => {
      if (p === path) return
      router.push(hrefForNotePath(p, entityByPath))
    },
    [entityByPath, path, router],
  )

  // `[[ ]]` mention picked in the editor: make sure the target entity's note
  // exists before the link lands (same contract as EntityContextPanel).
  const ensureEntityNote = useCallback(
    async (entity: PickerEntity): Promise<string> => {
      const p = entityNotePath(entity)
      if (!p) throw new Error('Not a directory entity')
      if (!spaceId) throw new Error('No space')
      try {
        await notesApi.create(spaceId, p, entityStub(entity))
        invalidateContextCache(
          contextKeys.read(spaceId, p),
          contextKeys.list(spaceId),
          contextKeys.tree(spaceId),
        )
      } catch (err) {
        if (!(err instanceof Error && /already exists/i.test(err.message))) throw err
      }
      return p
    },
    [spaceId],
  )

  // Everything answered FOR THE PATH BEING OPENED. `shown` may still be the note
  // being left when this is false; that lag is what keeps the toolbar up.
  const shownFresh = shown?.path === path && shown?.spaceId === spaceId
  const dataReady = shownFresh && (isPersonalSpace || accessPath === path) && configDone

  // "Nothing left to wait for" — the note being opened has fully landed, or we've
  // reached a terminal branch (gated out) that renders its own final surface. The
  // page holds its reveal until this flips, so the animation plays over the note.
  const revealReady = !!spaceId && (gatedOut || dataReady)
  useEffect(() => {
    if (revealReady) onReady?.()
  }, [revealReady, onReady])

  // Latched: once the surface has painted a note it never falls back to a skeleton,
  // it just keeps showing the note it has. Only the very first load skeletons.
  useEffect(() => {
    if (dataReady) setEverPainted(true)
  }, [dataReady])

  // ── Render states ───────────────────────────────────────────────────────────

  if (!spaceId) return <PanelSkeleton />

  if (gatedOut) {
    return (
      <AccessRequestCard
        scope="context"
        spaceName={currentSpace?.name ?? 'this space'}
        pending={requestPending}
        requesting={requesting}
        error={error}
        onRequest={requestAccess}
      />
    )
  }

  // First load only: nothing has ever painted, so there is no held note to show.
  // After that the panel always has `shown` and renders it, fresh or lagging.
  if (!shown || (!dataReady && !everPainted)) return <PanelSkeleton />

  const shownRead = shown.read
  // References are fetched for `path`; withhold them while the shown note lags so
  // the rail can't attribute one note's backlinks to another.
  const shownReferences = shownFresh ? references : null

  if (shownRead.status === 'error') {
    return (
      <div className="mx-auto max-w-3xl border-l-2 border-red-500 pl-3 py-1 text-center text-sm text-red-700">
        {shownRead.message}
      </div>
    )
  }
  // This surface only views existing notes — a bad/hidden path is never an
  // invitation to create. It IS an invitation to ask: readVisible 404s hidden
  // notes exactly like absent ones, so the card offers a request either way and
  // its copy commits to neither reading.
  if (shownRead.status === 'missing') {
    return (
      <AccessRequestCard
        scope="path"
        spaceName={currentSpace?.name ?? 'this space'}
        pending={requestPending}
        requesting={requesting}
        error={error}
        onRequest={requestAccess}
      />
    )
  }

  const title =
    openMeta?.title?.trim() ||
    String(parseFrontmatter(shownRead.content).title ?? '').trim() ||
    (shown.path.split('/').pop() ?? shown.path).replace(/\.md$/i, '')


  // The note title leads the scrolling content (embedded NoteEditor hides its
  // own .notes-title); width/padding mirror .notes-column so it lines up.
  // Type and tags come from the note's own frontmatter; the block itself decides
  // what counts as a type (see NoteMetaRows — console types only).
  const headerCard = (
    <div className="mx-auto mb-1 w-full max-w-[760px] px-7 pt-10">
      {/* leading-[1.25], not tighter: `truncate` hides overflow, so a line box
          shorter than the font's ascent+descent shaves the p/g/y descenders. */}
      <h2 className="min-w-0 truncate text-[2.5rem] font-semibold leading-[1.25] tracking-[-0.02em] text-text-primary font-open-sauce">
        {title}
      </h2>
      <NoteMetaRows
        className="mt-4"
        type={openMeta?.frontmatter.type}
        // A note that stands for a directory node is labelled by that node's
        // alias, the same name its card carries in the directory.
        alias={entityByPath.get(path)?.alias ?? null}
        tags={openMeta?.tags ?? []}
        nodeTypes={currentSpace?.nodeTypes}
        aliases={currentSpace?.aliases as SpaceAlias[] | undefined}
        tagColors={currentSpace?.designConfig?.tagColors ?? null}
      />
      {access?.subspace && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-secondary">
          <BlocksIcon className="h-4 w-4 shrink-0 text-brand-green" />
          <span>
            From <span className="font-medium">{access.subspace.name}</span>, a sub-space of this one —
            its own context, read here as it is now. To edit it, open that space.
          </span>
        </div>
      )}
      {isReplica && pubs?.asTarget && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-secondary">
          <RadioIcon className="h-4 w-4 shrink-0 text-brand-green" />
          <span>
            Published from <span className="font-medium">{pubs.asTarget.sourceSpaceName}</span> — kept in
            sync with its source, read-only here. Unlink it from Share to make it an editable copy.
          </span>
        </div>
      )}
    </div>
  )

  return (
    <div className="pb-10">
      {error && (
        <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between border-l-2 border-red-500 pl-3 py-1 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {/* Keyed and fed from `shown`, never from the in-flight `path`: the editor is
          the note it actually holds. When the next read lands, this key changes and
          React swaps the whole editor — and the toolbar it portals into the tab bar
          — on one commit. `initialContent` is read once at mount, so keying it this
          way is also what stops a stale body outliving its content. */}
      <NoteEditor
        key={shown.path}
        variant="embedded"
        headerSlot={headerCard}
        toolbarTrailSlot={share.fallback}
        path={shown.path}
        meta={openMeta}
        notes={noteRefs}
        initialContent={shownRead.content}
        canEdit={canWrite}
        aiConfigured={aiConfigured}
        mode={mode}
        onModeChange={onModeChange}
        references={shownReferences}
        entities={entities}
        entityByPath={entityByPath}
        onEnsureEntityNote={ensureEntityNote}
        onSave={handleSave}
        onOpenNote={handleOpenNote}
        onLinkMention={handleLinkMention}
        onRequestReferenceAccess={isPersonalSpace ? undefined : handleRequestReferenceAccess}
      />
      {share.slot}
      {shareOpen && (
        <SharePanel
          spaceId={spaceId}
          path={shown.path}
          kind="note"
          title={title}
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
