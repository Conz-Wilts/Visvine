'use client'

// The standalone note view (/directory/note/<path>): any non-entity brain note —
// folder indexes, sectors, deals, journal pages — in the embedded NoteEditor with
// the linked-references rail below. The slim sibling of EntityContextPanel: same
// gated /api/notes pipeline (brain gate, grant-based visibility and write denials
// come free), minus everything entity-specific (node profile, tags header, stub
// creation). A missing note here is just "not found" — this surface never creates.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Share2, Radio } from 'lucide-react'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { entityNotePath, entityStub, noteHref, resolveEntityNode } from '@/lib/notes/entities'
import type { NoteMeta, References } from '@/lib/notes/shared/types'
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
import { type NoteMode } from './NoteModeToggle'
import { BrainGateCard } from './BrainGateCard'
import { SharePanel } from './SharePanel'
import type { PickerEntity } from './NotePicker'
import '../notes.css'

const PERSONAL_ID_PREFIX = 'me:'

interface NoteContextPanelProps {
  path: string
  mode?: NoteMode
  onModeChange?: (mode: NoteMode) => void
}

export function NoteContextPanel({ path, mode = 'wysiwyg', onModeChange }: NoteContextPanelProps) {
  const router = useRouter()
  const { currentCommunity } = useCommunity()
  const communityId = currentCommunity?.id ?? null
  const isPersonalSpace = communityId?.startsWith(PERSONAL_ID_PREFIX) ?? false
  const { entities, entityByPath } = useDirectoryEntities()

  const [aiConfigured, setAiConfigured] = useState(false)
  const [access, setAccess] = useState<PathAccessResponse | null>(null)
  // "Answered" flags (not "answered with a value") so the panel holds one
  // skeleton until note + access + config are all in — same contract as
  // EntityContextPanel, see the comment there.
  const [accessDone, setAccessDone] = useState(false)
  const [configDone, setConfigDone] = useState(false)
  const [read, setRead] = useState<NoteRead | null>(null)
  const [notesIndex, setNotesIndex] = useState<NoteMeta[]>([])
  const [references, setReferences] = useState<References | null>(null)
  const [pubs, setPubs] = useState<PublicationStateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requestPending, setRequestPending] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
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

  useEffect(() => {
    setAccess(null)
    setAccessDone(false)
    if (!communityId || !path) return
    let stale = false
    swrFetch(
      contextKeys.access(communityId, path),
      () => notesApi.getAccess(communityId, path),
      (a) => {
        if (stale) return
        setAccess(a)
        setAccessDone(true)
      },
    ).catch(() => {
      if (!stale) {
        setAccess(null)
        setAccessDone(true)
      }
    })
    return () => { stale = true }
  }, [communityId, path])

  // When gated out, surface the viewer's own pending root-gate request.
  useEffect(() => {
    if (!gatedOut || !communityId || !access) {
      setRequestPending(false)
      return
    }
    notesApi
      .listJoinRequests(communityId)
      .then(({ requests }) =>
        setRequestPending(
          requests.some(
            (r) => r.folderId === '' && r.status === 'pending' && r.userId === access.me.userId,
          ),
        ),
      )
      .catch(() => setRequestPending(false))
  }, [gatedOut, communityId, access])

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

  // Load the note + the brain's note index + references.
  useEffect(() => {
    if (!communityId || !path) return
    const seq = ++loadSeq.current
    setRead(null)
    setReferences(null)
    setPubs(null)
    onModeChange?.('wysiwyg')
    // References fire in parallel with the read (no waterfall); their
    // results only apply once the read lands 'ok' — same as EntityContextPanel.
    const refsPromise = cachedFetch(contextKeys.references(communityId, path), () =>
      notesApi.references(communityId, path),
    )
    readNote(communityId, path).then((r) => {
      if (loadSeq.current !== seq) return
      setRead(r)
      if (r.status === 'ok') {
        refsPromise.then(({ references: refs }) => {
          if (loadSeq.current === seq) setReferences(refs)
        }).catch(() => {})
        // Replica banner: is this note a live published copy?
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
  const openMeta = useMemo(() => notesIndex.find((n) => n.path === path) ?? null, [notesIndex, path])

  // Server-computed, per-path (any-depth grants + restricted cuts included).
  // A live published replica is read-only here regardless of folder access.
  const isReplica = pubs?.asTarget != null
  const canWrite = (isPersonalSpace || (access?.canWrite ?? false)) && !isReplica

  const handleSave = useCallback(
    async (p: string, body: string, origin?: string) => {
      if (!communityId) return
      try {
        await notesApi.write(communityId, p, body, origin)
        invalidateContextCache(
          contextKeys.read(communityId, p),
          contextKeys.references(communityId, p),
          contextKeys.list(communityId),
          contextKeys.tree(communityId), // a save can create the note — the tree gains it
        )
        setError(null)
        cachedFetch(contextKeys.references(communityId, p), () => notesApi.references(communityId, p))
          .then(({ references: refs }) => setReferences(refs)).catch(() => {})
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    },
    [communityId],
  )

  // Links inside the note: entity → its profile Context tab; anything else →
  // its own note view.
  const handleOpenNote = useCallback(
    (p: string) => {
      if (p === path) return
      const targetId = resolveEntityNode(p, entityByPath)
      if (targetId) router.push(`/directory/${encodeURIComponent(targetId)}?tab=context`)
      else router.push(noteHref(p))
    },
    [entityByPath, path, router],
  )

  // `[[ ]]` mention picked in the editor: make sure the target entity's note
  // exists before the link lands (same contract as EntityContextPanel).
  const ensureEntityNote = useCallback(
    async (entity: PickerEntity): Promise<string> => {
      const p = entityNotePath({ id: entity.id, type: entity.type })
      if (!p) throw new Error('Not a directory entity')
      if (!communityId) throw new Error('No community')
      try {
        await notesApi.create(communityId, p, entityStub(entity))
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

  const dataReady = read !== null && (isPersonalSpace || accessDone) && configDone

  // ── Render states ───────────────────────────────────────────────────────────

  if (!communityId) return <PanelSkeleton />

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

  if (!dataReady) return <PanelSkeleton />

  if (read.status === 'error') {
    return (
      <div className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">
        {read.message}
      </div>
    )
  }
  // This surface only views existing notes — a bad/hidden path is a dead end,
  // not an invitation to create (readVisible 404s hidden notes the same way).
  if (read.status === 'missing') {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <p className="text-base font-semibold text-text-secondary">Note not found.</p>
        <p className="text-sm text-text-muted">It may have been moved, deleted, or you may not have access to it.</p>
      </div>
    )
  }

  const title =
    openMeta?.title?.trim() ||
    String(parseFrontmatter(read.content).title ?? '').trim() ||
    (path.split('/').pop() ?? path).replace(/\.md$/i, '')

  // The note title leads the scrolling content (embedded NoteEditor hides its
  // own .notes-title); width/padding mirror .notes-column so it lines up. The
  // Share button rides the title row — every note can answer "who sees this".
  const headerCard = (
    <div className="mx-auto mb-1 w-full max-w-[760px] px-7 pt-10">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 truncate text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.02em] text-text-primary font-open-sauce">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          title="Who can see this?"
          className="mt-3 flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-[13px] font-medium text-text-secondary transition hover:bg-surface-2"
        >
          <Share2 className="h-3.5 w-3.5" />
          Share
        </button>
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
    </div>
  )

  return (
    <div className="pb-10">
      {error && (
        <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      <NoteEditor
        key={path}
        variant="embedded"
        headerSlot={headerCard}
        path={path}
        meta={openMeta}
        notes={noteRefs}
        initialContent={read.content}
        canEdit={canWrite}
        aiConfigured={aiConfigured}
        mode={mode}
        onModeChange={onModeChange}
        references={references}
        entities={entities}
        entityByPath={entityByPath}
        onEnsureEntityNote={ensureEntityNote}
        onSave={handleSave}
        onOpenNote={handleOpenNote}
      />
      {shareOpen && (
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
