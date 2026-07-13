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
import { useRouter } from 'next/navigation'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { useNodeProfile } from '@/hooks/useNodeProfile'
import { entityNotePath, entityStub, resolveEntityNode } from '@/lib/notes/entities'
import type { NoteMeta, References, RelatedNote } from '@/lib/notes/shared/types'
import { notesApi, type RegistryResponse } from '../lib/notesApi'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { NoteEditor } from './NoteEditor'
import { NoteModeToggle, type NoteMode } from './NoteModeToggle'
import { RevisionHistory } from './RevisionHistory'
import { BrainGateCard } from './BrainGateCard'
import type { PickerEntity } from './NotePicker'
import '../notes.css'

const PERSONAL_ID_PREFIX = 'me:'

type NoteRead =
  | { status: 'ok'; content: string }
  | { status: 'missing' }
  | { status: 'error'; message: string }

// Status-aware single-note read: the shared notesApi.read collapses every
// failure into one thrown Error, but this panel must treat "no note yet" (404,
// editable empty state) differently from a transient failure (read-only error
// state — never risk upserting the stub over content we simply failed to load).
async function readNoteWithStatus(communityId: string, path: string): Promise<NoteRead> {
  try {
    const params = new URLSearchParams({ communityId, path })
    const res = await fetch(`/api/notes/item?${params.toString()}`)
    if (res.status === 404) return { status: 'missing' }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return { status: 'error', message: data.error || `Request failed (${res.status})` }
    }
    const { content } = (await res.json()) as { content: string }
    return { status: 'ok', content }
  } catch {
    return { status: 'error', message: 'Failed to load the context note' }
  }
}

export function EntityContextPanel({ nodeId }: { nodeId: string }) {
  const router = useRouter()
  const { currentCommunity } = useCommunity()
  const communityId = currentCommunity?.id ?? null
  const isPersonalSpace = communityId?.startsWith(PERSONAL_ID_PREFIX) ?? false

  const { data: profileData, loading: nodeLoading } = useNodeProfile(nodeId)
  const node = profileData?.node ?? null
  const { entities, entityByPath } = useDirectoryEntities()

  const path = node ? entityNotePath({ id: nodeId, type: node.type }) : null

  const [aiConfigured, setAiConfigured] = useState(false)
  const [registry, setRegistry] = useState<RegistryResponse | null>(null)
  const [read, setRead] = useState<NoteRead | null>(null)
  const [noteExists, setNoteExists] = useState(false)
  const [notesIndex, setNotesIndex] = useState<NoteMeta[]>([])
  const [references, setReferences] = useState<References | null>(null)
  const [related, setRelated] = useState<RelatedNote[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [mode, setMode] = useState<NoteMode>('wysiwyg')
  const [historyOpen, setHistoryOpen] = useState(false)
  // Bumped after a revision restore so the load effect re-reads the note.
  const [reloadKey, setReloadKey] = useState(0)
  const [requestPending, setRequestPending] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const loadSeq = useRef(0)

  const gatedOut = !isPersonalSpace && registry !== null && !registry.gate.canRead

  useEffect(() => {
    notesApi.config().then((c) => setAiConfigured(c.aiConfigured)).catch(() => {})
  }, [])

  useEffect(() => {
    setRegistry(null)
    if (!communityId) return
    notesApi.getRegistry(communityId).then(setRegistry).catch(() => setRegistry(null))
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
    setMode('wysiwyg')
    readNoteWithStatus(communityId, path).then((r) => {
      if (loadSeq.current !== seq) return
      setRead(r)
      setNoteExists(r.status === 'ok')
      if (r.status === 'ok') {
        notesApi.references(communityId, path).then(({ references: refs }) => {
          if (loadSeq.current === seq) setReferences(refs)
        }).catch(() => {})
        notesApi.related(communityId, path).then(({ related: rel }) => {
          if (loadSeq.current === seq) setRelated(rel)
        }).catch(() => {})
      }
    })
    notesApi.list(communityId).then((l) => {
      if (loadSeq.current === seq) setNotesIndex(l.notes)
    }).catch(() => {})
  }, [communityId, path, reloadKey])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

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
        setNoteExists(true)
        setError(null)
        notesApi.references(communityId, p).then(({ references: refs }) => setReferences(refs)).catch(() => {})
        notesApi.related(communityId, p).then(({ related: rel }) => setRelated(rel)).catch(() => {})
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
      } catch (err) {
        if (!(err instanceof Error && /already exists/i.test(err.message))) throw err
      }
      return p
    },
    [communityId],
  )

  // Keep a private copy in the viewer's personal space (me:<userId>) — the
  // affordance EntityNoteHeader used to carry.
  const myPersonalCommunityId = registry ? `${PERSONAL_ID_PREFIX}${registry.me.userId}` : null
  const addToPersonal = useCallback(async () => {
    if (!myPersonalCommunityId || !path || !node) return
    try {
      await notesApi.create(
        myPersonalCommunityId,
        path,
        entityStub({ id: nodeId, type: node.type, name: node.name, subtitle: node.subtitle ?? null }),
      )
      setToast(`Added ${node.name} to your personal notes`)
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) {
        setToast(`${node.name} is already in your notes`)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to add to your personal notes')
      }
    }
  }, [myPersonalCommunityId, path, node, nodeId])

  // Delete = clear this entity's context (soft-delete; the row survives in the
  // notes trash table, but there is no trash UI anymore — restore is a data
  // operation). The panel drops back to the empty state.
  const handleDelete = useCallback(async () => {
    if (!communityId || !path) return
    try {
      await notesApi.remove(communityId, path)
      setRead({ status: 'missing' })
      setNoteExists(false)
      setReferences(null)
      setRelated(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }, [communityId, path])

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

  const loadingNote = read === null
  const readFailed = read?.status === 'error'
  const showEditor = !loadingNote && !readFailed && (noteExists || canWrite)

  return (
    <div className="pb-10">
      {error && (
        <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {toast && (
        <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between rounded-lg border border-brand-green/30 bg-brand-light-bg px-3 py-2 text-sm text-brand-dark-green">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-brand-dark-green/60 hover:text-brand-dark-green">✕</button>
        </div>
      )}

      {(showEditor || (!isPersonalSpace && myPersonalCommunityId)) && (
        <div className="mb-2 flex items-center justify-end gap-2">
          {!isPersonalSpace && myPersonalCommunityId && (
            <button
              type="button"
              onClick={addToPersonal}
              title="Keep a private copy of this context note in your personal space"
              className="rounded-full border border-border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
            >
              Add to my notes
            </button>
          )}
          {showEditor && <NoteModeToggle value={mode} onChange={setMode} />}
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
            key={`${path}:${reloadKey}`}
            variant="embedded"
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
            onShowHistory={noteExists ? () => setHistoryOpen(true) : undefined}
            exportHref={noteExists ? notesApi.exportUrl(communityId, path) : undefined}
            onDelete={noteExists && canWrite ? handleDelete : undefined}
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <p className="text-base font-semibold text-text-secondary">No shared context for {node.name} yet.</p>
          <p className="text-sm text-text-muted">Members with write access can start this entity&apos;s context note.</p>
        </div>
      )}

      {historyOpen && (
        <RevisionHistory
          communityId={communityId}
          path={path}
          onRestored={() => setReloadKey((k) => k + 1)}
          onClose={() => setHistoryOpen(false)}
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
