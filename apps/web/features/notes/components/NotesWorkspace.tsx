'use client'

// The notes workspace: orchestrates the sidebar tree, the editor, and the
// backlinks/related rail for the CURRENT community's single brain. It renders
// as the directory's Context view (`embedded` — /directory?view=context; the
// old /context route redirects there). Personal vs community context is not a
// toggle — a user's personal notes live in their personal-space community
// (`me:<userId>`), and this workspace simply points at whichever community
// you're in. Entity context notes (people/…, companies/…) never open here:
// openNote routes them to their entity's profile Context tab. Owns all data
// loading (plain fetch + state, Visvine convention) and refreshes the index
// after mutations. Markdown is the source of truth end to end.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { useContextPanel } from '@/lib/contexts/ContextPanelContext'
import { useHeader } from '@/lib/contexts/HeaderContext'
import { ViewToggle, type ViewToggleOption } from '@/components/ui'
import { entityNotePath, entityStub, resolveEntityNode } from '@/lib/notes/entities'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { notesApi, type RegistryResponse } from '../lib/notesApi'
import { BrainGateCard } from './BrainGateCard'
import { NoteSidebar, type FolderBadge } from './NoteSidebar'
import { NoteEditor } from './NoteEditor'
import { NoteSearchBox } from './NoteSearchBox'
import { NotePicker, type PickerEntity } from './NotePicker'
import { CreateModal } from './CreateModal'
import { NotesGraph } from './NotesGraph'
import { CommandPalette, type Command } from './CommandPalette'
import { RevisionHistory } from './RevisionHistory'
import { TrashModal } from './TrashModal'
import { ReorganizeModal } from './ReorganizeModal'
import { FolderAccessModal } from './FolderAccessModal'
import { PromoteDialog } from './PromoteDialog'
import { CaptureBox } from './CaptureBox'
import { BrainHealthModal } from './BrainHealthModal'
import type { NoteMeta, TreeNode, References, RelatedNote, GraphData } from '@/lib/notes/shared/types'
import type { LinkInsights } from '@/lib/notes/shared/insights'
import '../notes.css'

// Personal-space communities carry a deterministic `me:<userId>` id (see
// lib/onboarding/personalCommunity.ts#personalCommunityId). The client-side
// Community object doesn't expose `personalOwnerId`, so the id prefix is the
// one reliable signal that "this Context page is my personal space".
const PERSONAL_ID_PREFIX = 'me:'

// The Context tree no longer positions itself: the global Sidebar owns a
// full-height docked card while this workspace is mounted (it requests the dock
// via ContextPanelContext) and exposes a portal host where we mount
// <NoteSidebar>, so the icon rail + tree read as one container. We only reserve
// the editor's left padding so it clears that card. PANEL_W (256) mirrors the host's
// width in Sidebar.tsx; the 268/52px offsets = PANEL_W + a 12px gap / the collapsed
// reopen button + a gutter. The page content sits inside <main>, which already pads
// past the rail, so these offsets only need to clear the tree portion beyond it.
function collectFolderPaths(tree: TreeNode | null): string[] {
  const out: string[] = []
  const walk = (node: TreeNode) => {
    for (const child of node.children ?? []) {
      if (child.kind === 'folder') {
        out.push(child.path)
        walk(child)
      }
    }
  }
  if (tree) walk(tree)
  return out.sort()
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

function defaultNoteContent(title: string): string {
  // The title renders as the note heading from frontmatter, so the body starts
  // empty — no duplicate `# Title` line.
  return `---\ntype: Note\ntitle: ${title}\ntags: []\n---\n\n`
}

// The workspace's Graph/Editor/Raw pill options — rendered into the navbar on
// /context and inline (chrome row) when embedded in the directory.
const WORKSPACE_VIEW_OPTIONS: ViewToggleOption<'graph' | 'editor' | 'raw'>[] = [
  {
    id: 'graph',
    label: 'Graph',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7a3 3 0 116 0 3 3 0 01-6 0zM3 17a3 3 0 116 0 3 3 0 01-6 0zM15 17a3 3 0 116 0 3 3 0 01-6 0zM9.5 9.5l-3 5M14.5 9.5l3 5" />
      </svg>
    ),
  },
  {
    id: 'editor',
    label: 'Editor',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    id: 'raw',
    label: 'Raw',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
]

export function NotesWorkspace({ embedded = false }: { embedded?: boolean }) {
  const { currentCommunity, joinedCommunities } = useCommunity()
  const { host, collapsed, setDockRequested } = useContextPanel()
  const { setHeaderRight, setHeaderContent } = useHeader()
  const communityId = currentCommunity?.id ?? null
  const isPersonalSpace = communityId?.startsWith(PERSONAL_ID_PREFIX) ?? false
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Directory entities (person/org nodes) usable in `[[ ]]` mentions: the picker
  // list + a path→entity map the chip decoration reads (shared with the profile
  // Context tab via useDirectoryEntities).
  const { entities, entityByPath } = useDirectoryEntities()

  const [aiConfigured, setAiConfigured] = useState(false)

  const [tree, setTree] = useState<TreeNode | null>(null)
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [pinned, setPinned] = useState<string[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [references, setReferences] = useState<References | null>(null)
  const [related, setRelated] = useState<RelatedNote[] | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createKind, setCreateKind] = useState<'note' | 'folder' | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  // The active workspace surface. The graph is the landing screen (with a search
  // box floated on top); Editor/Raw are the open note's two modes (only reachable
  // once a note is open).
  const [view, setView] = useState<'graph' | 'editor' | 'raw'>('graph')
  const [graphData, setGraphData] = useState<{ graph: GraphData; insights: LinkInsights } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [reorganizeOpen, setReorganizeOpen] = useState(false)
  // Brain capability surfaces: quick capture, share-to-community (from the
  // personal space), folder access management, and the review/proposals/audit panel.
  const [captureOpen, setCaptureOpen] = useState(false)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  // Which folder the access panel opened on (null folderId = let the modal pick).
  const [folderAccess, setFolderAccess] = useState<{ folderId: string | null } | null>(null)
  // The brain's folder registry (lock badges, admin bit, and the brain gate).
  const [registry, setRegistry] = useState<RegistryResponse | null>(null)
  // Gated-out state: this community's brain is admin-gated and the viewer can't
  // read it. `brainRequestPending` tracks their own pending root-gate request.
  const [brainRequestPending, setBrainRequestPending] = useState(false)
  const [requestingAccess, setRequestingAccess] = useState(false)
  // Post-create "also keep a personal copy?" prompt, and a transient neutral toast.
  const [entityPrompt, setEntityPrompt] = useState<{ path: string; name: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Latest directory map, read by the load effect's self-heal without making it a
  // dependency (so the open note isn't re-read every time the directory graph loads).
  const entityByPathRef = useRef(entityByPath)
  entityByPathRef.current = entityByPath

  const loadSeq = useRef(0)
  const noteRefs = useMemo(() => notes.map((n) => ({ path: n.path, title: n.title })), [notes])
  const folders = useMemo(() => collectFolderPaths(tree), [tree])
  const selectedMeta = useMemo(
    () => notes.find((n) => n.path === selectedPath) ?? null,
    [notes, selectedPath],
  )

  // Physical top-level folders (the registry's unit of access control).
  const topLevelFolders = useMemo(() => folders.filter((f) => !f.includes('/')), [folders])
  const isCommunityAdmin = registry?.me.communityAdmin ?? false
  // The viewer is gated out of this community's brain (never in a personal space).
  const gatedOut = !isPersonalSpace && registry !== null && !registry.gate.canRead
  // The viewer's own personal-space community id (for cross-community personal copies).
  const myPersonalCommunityId = registry ? `${PERSONAL_ID_PREFIX}${registry.me.userId}` : null

  // Promote targets: the user's non-personal communities, excluding the current one.
  const promoteTargets = useMemo(
    () =>
      joinedCommunities
        .filter((c) => !c.id.startsWith(PERSONAL_ID_PREFIX) && c.id !== communityId)
        .map((c) => ({ id: c.id, name: c.name })),
    [joinedCommunities, communityId],
  )

  // Sidebar adornments for registered folders: 🔒 for private, the viewer's level
  // chip, keyed by top-level folder id. No governance chrome in your own space.
  const folderBadges = useMemo<Map<string, FolderBadge> | undefined>(() => {
    if (isPersonalSpace || !registry) return undefined
    return new Map(
      registry.folders
        .filter((f) => f.id !== '')
        .map((f) => [
          f.id,
          { private: f.visibility === 'private', locked: f.locked, level: f.myLevel },
        ]),
    )
  }, [isPersonalSpace, registry])

  // Fused full-text search for the search box (debounced there); a thrown error
  // makes the box fall back to its client-side fuzzy matching.
  const serverSearch = useCallback(
    (query: string) => {
      if (!communityId) return Promise.reject(new Error('No community'))
      return notesApi.searchNotes(communityId, query).then((r) => r.results)
    },
    [communityId],
  )

  // Arriving with ?new=note (e.g. from the global "Create new → Context" tile)
  // creates a "New note" straight away and opens it in the editor — no name
  // dialog. The param is cleared immediately; the create itself waits for the
  // community to resolve (pendingNewNote), so a cold navigation still works.
  const [pendingNewNote, setPendingNewNote] = useState(false)
  useEffect(() => {
    if (searchParams.get('new') === 'note') {
      setPendingNewNote(true)
      // Strip only the `new` param — clobbering the whole query string would
      // nuke the directory's ?view=context (and any ?file=) when embedded.
      const params = new URLSearchParams(searchParams.toString())
      params.delete('new')
      const q = params.toString()
      router.replace(q ? `${pathname}?${q}` : pathname)
    }
  }, [searchParams, pathname, router])

  // Embedded (directory Context view): ask the Sidebar to open the docked tree
  // column while mounted; release it on unmount (leaving the view or the page).
  useEffect(() => {
    if (!embedded) return
    setDockRequested(true)
    return () => setDockRequested(false)
  }, [embedded, setDockRequested])

  // AI availability (once).
  useEffect(() => {
    notesApi.config().then((c) => setAiConfigured(c.aiConfigured)).catch(() => {})
  }, [])

  // The brain's folder registry: lock badges in the sidebar, the community-admin
  // bit, and the root gate (can the viewer read this brain at all?). Best-effort —
  // the workspace works without it (modals fetch their own fresh copy).
  const refreshRegistry = useCallback(() => {
    if (!communityId) return
    notesApi.getRegistry(communityId).then(setRegistry).catch(() => setRegistry(null))
  }, [communityId])

  useEffect(() => {
    setRegistry(null)
    refreshRegistry()
  }, [refreshRegistry])

  // When gated out, check whether the viewer already has a pending request for
  // the brain root gate (folderId '') so the CTA can show "request pending".
  useEffect(() => {
    if (!gatedOut || !communityId || !registry) {
      setBrainRequestPending(false)
      return
    }
    notesApi
      .listJoinRequests(communityId)
      .then(({ requests }) =>
        setBrainRequestPending(
          requests.some(
            (r) => r.folderId === '' && r.status === 'pending' && r.userId === registry.me.userId,
          ),
        ),
      )
      .catch(() => setBrainRequestPending(false))
  }, [gatedOut, communityId, registry])

  const requestBrainAccess = async () => {
    if (!communityId) return
    setRequestingAccess(true)
    setError(null)
    try {
      await notesApi.requestJoin(communityId, '')
      setBrainRequestPending(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request access')
    } finally {
      setRequestingAccess(false)
    }
  }

  // Auto-dismiss the transient neutral toast.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const loadIndex = useCallback(
    async (autoSelect: boolean) => {
      if (!communityId) return
      setLoading(true)
      setError(null)
      try {
        const [list, treeRes] = await Promise.all([
          notesApi.list(communityId),
          notesApi.tree(communityId),
        ])
        setNotes(list.notes)
        setPinned(list.pinned)
        setTree(treeRes.tree)
        if (autoSelect) {
          setSelectedPath((cur) => {
            const keep = cur && list.notes.some((n) => n.path === cur) ? cur : null
            return (
              keep ?? list.notes.find((n) => n.path.toLowerCase() === 'welcome.md')?.path ?? list.notes[0]?.path ?? null
            )
          })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notes')
      } finally {
        setLoading(false)
      }
    },
    [communityId],
  )

  // --- URL sync (embedded only): ?file=<path> mirrors the open note, making
  // notes addressable — deep links, refresh, and back/forward all restore the
  // open note inside the directory's Context view. ---------------------------
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams
  // Mirror of selectedPath for the read-back effect's loop guard (the URL echo
  // of an openNote() must not re-open the note it just came from).
  const selectedPathRef = useRef(selectedPath)
  selectedPathRef.current = selectedPath

  const writeFileParam = useCallback(
    (file: string | null) => {
      if (!embedded) return
      const params = new URLSearchParams(searchParamsRef.current.toString())
      if (file) params.set('file', file)
      else params.delete('file')
      const q = params.toString()
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    },
    [embedded, pathname, router],
  )

  // Reload the index whenever the community changes, landing on the graph screen
  // with no note open (notes are opened from there). Only an actual community
  // SWITCH clears ?file= — on first mount it may carry a deep link that the
  // read-back effect below is about to honour.
  const prevCommunityRef = useRef<string | null>(null)
  useEffect(() => {
    const isSwitch = prevCommunityRef.current !== null && prevCommunityRef.current !== communityId
    prevCommunityRef.current = communityId
    setSelectedPath(null)
    setContent('')
    setReferences(null)
    setRelated(null)
    setView('graph')
    if (isSwitch) writeFileParam(null)
    loadIndex(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadIndex])

  // Open a note into the editor (the one entry point used by search, the sidebar,
  // pickers, the graph, and in-note links). Entity context notes don't open here
  // at all — they ARE their entity's profile context, so they route to the
  // profile's Context tab. An entity-shaped path whose node isn't in the loaded
  // directory map (deleted node, other community's copy, map still loading)
  // falls back to the plain in-workspace editor so no click ever dead-ends.
  const openNote = useCallback(
    (path: string) => {
      const entityNodeId = resolveEntityNode(path, entityByPathRef.current)
      if (entityNodeId) {
        router.push(`/directory/${encodeURIComponent(entityNodeId)}?tab=context`)
        return
      }
      setError(null)
      setSelectedPath(path)
      setView('editor')
      writeFileParam(path)
    },
    [router, writeFileParam],
  )

  // Deep links / back-forward: an externally-changed ?file= opens that note
  // (entity paths hand off to the profile tab like every other open). Also
  // re-applies after the community-arrival reset above — the community object
  // resolves async on a cold load, and its reset would otherwise clobber the
  // deep-linked selection back to the graph (hence the communityId dep; this
  // effect is declared after the reset so it runs later in the same flush).
  useEffect(() => {
    if (!embedded) return
    const file = searchParams.get('file')
    if (!file || file === selectedPathRef.current) return
    const entityNodeId = resolveEntityNode(file, entityByPathRef.current)
    if (entityNodeId) {
      router.replace(`/directory/${encodeURIComponent(entityNodeId)}?tab=context`)
      return
    }
    setError(null)
    setSelectedPath(file)
    setView('editor')
  }, [embedded, searchParams, communityId, router])

  // Fulfil a pending "new context" intent: create an untitled "New note" (with a
  // numeric suffix if one already exists) and open it straight in the editor.
  // In a community brain we wait for the registry and require root write access
  // (the Create-modal tile is already hidden without it — this is the backstop).
  useEffect(() => {
    if (!pendingNewNote || !communityId) return
    if (!isPersonalSpace) {
      if (registry === null) return // registry still loading — keep the intent pending
      if (gatedOut || !registry.gate.canWrite) {
        setPendingNewNote(false)
        setError("You don't have write access to this community's notes")
        return
      }
    }
    setPendingNewNote(false)
    const title = 'New note'
    ;(async () => {
      try {
        let path = 'new-note.md'
        for (let i = 2; ; i++) {
          try {
            await notesApi.create(communityId, path, defaultNoteContent(title))
            break
          } catch (err) {
            if (err instanceof Error && /already exists/i.test(err.message) && i <= 100) {
              path = `new-note-${i}.md`
            } else {
              throw err
            }
          }
        }
        await loadIndex(false)
        openNote(path)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create note')
      }
    })()
  }, [pendingNewNote, communityId, isPersonalSpace, registry, gatedOut, loadIndex, openNote])

  // Load the open note's content + references + related.
  useEffect(() => {
    if (!communityId || !selectedPath) {
      setContent('')
      setReferences(null)
      setRelated(null)
      return
    }
    const seq = ++loadSeq.current
    const path = selectedPath
    // Clear the previous note's body up front so a slow/failed open never shows a
    // ghost of the note you came from under the new heading.
    setContent('')
    setReferences(null)
    setRelated(null)
    notesApi
      .read(communityId, path)
      .then(({ content: c }) => {
        if (loadSeq.current === seq) {
          setContent(c)
          setError(null) // a successful open clears any stale error toast
        }
      })
      .catch(async (err) => {
        if (loadSeq.current !== seq) return
        // Self-heal: a directory entity can lack a seeded context note. If this is
        // a known entity, create its stub from the directory entity and re-read
        // once before surfacing an error.
        const entity = entityByPathRef.current?.get(path)
        if (entity) {
          try {
            await notesApi.create(communityId, path, entityStub(entity))
          } catch {
            /* tolerate already-exists / a concurrent create */
          }
          try {
            const { content: c } = await notesApi.read(communityId, path)
            if (loadSeq.current === seq) {
              setContent(c)
              setError(null)
            }
            return
          } catch {
            /* fall through to the original error */
          }
        }
        if (loadSeq.current === seq) setError(err instanceof Error ? err.message : 'Failed to open note')
      })
    notesApi.references(communityId, path).then(({ references: r }) => {
      if (loadSeq.current === seq) setReferences(r)
    }).catch(() => {})
    notesApi.related(communityId, path).then(({ related: r }) => {
      if (loadSeq.current === seq) setRelated(r)
    }).catch(() => {})
  }, [communityId, selectedPath])

  // Persist an edit, then refresh the index + the open note's references/related
  // (links/tags may have changed). Does NOT touch `content`, so the editor keeps
  // its cursor — initialContent only changes on a note switch.
  const handleSave = useCallback(
    async (path: string, body: string, origin?: string) => {
      if (!communityId) return
      try {
        await notesApi.write(communityId, path, body, origin)
        const [list, treeRes] = await Promise.all([
          notesApi.list(communityId),
          notesApi.tree(communityId),
        ])
        setNotes(list.notes)
        setPinned(list.pinned)
        setTree(treeRes.tree)
        if (selectedPath === path) {
          notesApi.references(communityId, path).then(({ references: r }) => setReferences(r)).catch(() => {})
          notesApi.related(communityId, path).then(({ related: r }) => setRelated(r)).catch(() => {})
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    },
    [communityId, selectedPath],
  )

  // Ensure a directory entity's context note exists in THIS community's brain,
  // then return its path. Picking `[[Craig Piggott]]` calls this before inserting
  // the link, so the mention always resolves to a real note (graph + backlinks
  // light up). In a community we then offer to also keep a personal copy (in the
  // user's personal-space brain).
  const onEnsureEntityNote = useCallback(
    async (entity: PickerEntity): Promise<string> => {
      const path = entityNotePath({ id: entity.id, type: entity.type })
      if (!path) throw new Error('Not a directory entity')
      if (!communityId) throw new Error('No community')
      let created = false
      try {
        await notesApi.create(communityId, path, entityStub(entity))
        created = true
      } catch (err) {
        // Tolerate a note that already exists (seeded / created elsewhere).
        if (!(err instanceof Error && /already exists/i.test(err.message))) throw err
      }
      if (created) {
        await loadIndex(false)
        if (!isPersonalSpace) setEntityPrompt({ path, name: entity.name })
      }
      return path
    },
    [communityId, isPersonalSpace, loadIndex],
  )

  // Keep a private copy of an entity note in the user's PERSONAL-SPACE brain (a
  // fresh stub, separate from the community writeup). Tolerant of one already
  // existing. Cross-community write: targets `me:<userId>`, not the current brain.
  const onAddToPersonal = useCallback(
    async (path: string) => {
      if (!myPersonalCommunityId) return
      const entity = entityByPath.get(path)
      if (!entity) return
      setEntityPrompt(null)
      try {
        await notesApi.create(myPersonalCommunityId, path, entityStub(entity))
        setToast(`Added ${entity.name} to your personal notes`)
      } catch (err) {
        if (err instanceof Error && /already exists/i.test(err.message)) {
          setToast(`${entity.name} is already in your notes`)
        } else {
          setError(err instanceof Error ? err.message : 'Failed to add to your personal notes')
        }
      }
    },
    [myPersonalCommunityId, entityByPath],
  )

  const handleCreate = async (name: string, folder: string) => {
    if (!communityId || !createKind) return
    try {
      if (createKind === 'note') {
        const slug = slugify(name)
        const path = folder ? `${folder}/${slug}.md` : `${slug}.md`
        await notesApi.create(communityId, path, defaultNoteContent(name))
        await loadIndex(false)
        openNote(path)
      } else {
        const path = folder ? `${folder}/${slugify(name)}` : slugify(name)
        await notesApi.createFolder(communityId, path)
        await loadIndex(false)
      }
      setCreateKind(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  const handleDelete = async (path: string) => {
    if (!communityId) return
    try {
      await notesApi.remove(communityId, path)
      if (selectedPath === path) {
        setSelectedPath(null)
        setView('graph')
      }
      await loadIndex(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleTogglePin = async (path: string, pin: boolean) => {
    if (!communityId) return
    setPinned((cur) => (pin ? [...cur, path] : cur.filter((p) => p !== path)))
    try {
      await notesApi.pin(communityId, path, pin)
    } catch {
      // revert on failure
      setPinned((cur) => (pin ? cur.filter((p) => p !== path) : [...cur, path]))
    }
  }

  // Capture always lands in the user's personal log; only when this workspace IS
  // the personal space can we open the log note right here.
  const handleOpenLog = useCallback(
    (path: string) => {
      loadIndex(false)
      openNote(path)
    },
    [loadIndex, openNote],
  )

  // Load graph data when the graph view is active (and on community change).
  useEffect(() => {
    if (view !== 'graph' || !communityId || gatedOut) return
    let alive = true
    notesApi
      .graph(communityId)
      .then(({ graph, insights }) => {
        if (alive) setGraphData({ graph, insights })
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load graph')
      })
    return () => {
      alive = false
    }
  }, [view, communityId, notes, gatedOut])

  // Keyboard shortcuts: ⌘P quick switcher, ⇧⌘P command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'p' && !e.shiftKey) {
        e.preventDefault()
        setQuickOpen(true)
      } else if (k === 'p' && e.shiftKey) {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'new-note', label: 'New note', run: () => { setPaletteOpen(false); setCreateKind('note') } },
      { id: 'new-folder', label: 'New folder', run: () => { setPaletteOpen(false); setCreateKind('folder') } },
      { id: 'find', label: 'Jump to note', hint: '⌘P', run: () => { setPaletteOpen(false); setQuickOpen(true) } },
      { id: 'graph', label: 'Show link graph', run: () => { setPaletteOpen(false); setView('graph') } },
      { id: 'trash', label: 'Open trash', run: () => { setPaletteOpen(false); setTrashOpen(true) } },
      { id: 'capture', label: 'Quick capture', run: () => { setPaletteOpen(false); setCaptureOpen(true) } },
    ]
    if (selectedPath) {
      list.push({ id: 'history', label: 'Version history of this note', run: () => { setPaletteOpen(false); setHistoryOpen(true) } })
    }
    if (aiConfigured) {
      list.push({ id: 'reorganize', label: 'Reorganize notes with AI', run: () => { setPaletteOpen(false); setReorganizeOpen(true) } })
    }
    if (!isPersonalSpace) {
      list.push({
        id: 'folder-access',
        label: 'Folder access…',
        run: () => {
          setPaletteOpen(false)
          // Open on the current note's top-level folder when there is one.
          const fid = selectedPath && selectedPath.includes('/') ? selectedPath.slice(0, selectedPath.indexOf('/')) : null
          setFolderAccess({ folderId: fid })
        },
      })
    }
    if (isPersonalSpace && selectedPath) {
      list.push({ id: 'promote', label: 'Share to community…', run: () => { setPaletteOpen(false); setPromoteOpen(true) } })
    }
    // Brain health is for everyone: review in your own space; in a community,
    // members reach Proposals + Distill there (admins also Review/Audit).
    list.push({ id: 'brain-health', label: 'Brain health', run: () => { setPaletteOpen(false); setHealthOpen(true) } })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isPersonalSpace, selectedPath, aiConfigured, isCommunityAdmin])

  // The Graph/Editor/Raw view selector lives in the navbar, to the left of the
  // profile icon — sharing the directory's animated brand-green ViewToggle so the
  // two read as the same control. All three options are always shown; picking
  // Editor/Raw with no note open lands on the "select a note" placeholder.
  // Embedded: the navbar belongs to the directory's own 4-way switcher, so the
  // pill renders inline in the view body instead (see the chrome row below).
  useEffect(() => {
    if (embedded) return
    setHeaderRight(<ViewToggle options={WORKSPACE_VIEW_OPTIONS} value={view} onChange={setView} />)
    return () => setHeaderRight(null)
  }, [embedded, view, setHeaderRight])

  // Brain actions ride in the navbar's centre slot rather than a page row, so the
  // editor sits flush under the navbar with no intervening chrome for the note
  // text to scroll behind. (Embedded: inline chrome row instead.)
  useEffect(() => {
    if (embedded) return
    setHeaderContent(
      <div className="flex items-center justify-center gap-2">
        {isPersonalSpace && selectedPath && (
          <GhostAction onClick={() => setPromoteOpen(true)} title="Share this note to a community's brain">↑ Share</GhostAction>
        )}
        {aiConfigured && (
          <GhostAction onClick={() => setReorganizeOpen(true)} title="Reorganize with AI">✨ Reorganize</GhostAction>
        )}
      </div>,
    )
    return () => setHeaderContent(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, isPersonalSpace, aiConfigured, selectedPath, isCommunityAdmin, setHeaderContent])

  // Embedded, the page supplies a fixed-height box (like the graph view);
  // standalone /context sizes itself against the viewport.
  const rootHeight = embedded ? 'h-full' : 'h-[calc(100dvh-120px)]'

  if (!currentCommunity) {
    return (
      <div className={`flex w-full items-center justify-center ${embedded ? 'h-full' : 'h-[calc(100dvh-56px)]'}`}>
        <p className="text-text-muted">Select a community to view notes.</p>
      </div>
    )
  }

  const searchPlaceholder = isPersonalSpace ? 'Search your notes…' : `Search ${currentCommunity.name}…`

  // Reserve the editor's left padding so it clears the Sidebar's docked tree card.
  // Both literals must stay verbatim so Tailwind's JIT emits them.
  const contentPad = collapsed ? 'lg:pl-[52px]' : 'lg:pl-[268px]'

  // Gated brain: the viewer can't read this community's brain at all — replace
  // the workspace with a friendly request-access state (root gate, folderId '').
  if (gatedOut) {
    return (
      <div className={`relative flex ${rootHeight} w-full flex-col ${contentPad}`}>
        {error && (
          <div className="mx-auto mt-3 flex max-w-3xl items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
          </div>
        )}
        <div className="flex flex-1 items-center justify-center px-8">
          <BrainGateCard
            communityName={currentCommunity.name}
            pending={brainRequestPending}
            requesting={requestingAccess}
            onRequest={requestBrainAccess}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={`relative flex ${rootHeight} w-full flex-col ${contentPad}`}
      style={{ transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)' }}
    >
      {/* Embedded chrome: the navbar belongs to the directory's 4-way view
          switcher, so the workspace's own pill + brain actions render inline. */}
      {embedded && (
        <div className="flex flex-none items-center justify-end gap-2 px-4 pb-1 pt-2">
          {isPersonalSpace && selectedPath && (
            <GhostAction onClick={() => setPromoteOpen(true)} title="Share this note to a community's brain">↑ Share</GhostAction>
          )}
          {aiConfigured && (
            <GhostAction onClick={() => setReorganizeOpen(true)} title="Reorganize with AI">✨ Reorganize</GhostAction>
          )}
          <ViewToggle options={WORKSPACE_VIEW_OPTIONS} value={view} onChange={setView} />
        </div>
      )}
      {error && (
        <div className="mx-auto mt-3 flex max-w-3xl items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* After a new entity note is saved to the community directory, offer a personal copy. */}
      {entityPrompt && (
        <div className="mx-auto mt-3 flex max-w-3xl items-center justify-between gap-3 rounded-lg border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-secondary shadow-soft">
          <span>
            Added <span className="font-semibold text-text-primary">{entityPrompt.name}</span> to the community directory.
          </span>
          <span className="flex flex-none items-center gap-1.5">
            {myPersonalCommunityId && (
              <button
                onClick={() => onAddToPersonal(entityPrompt.path)}
                className="rounded-full border border-border-subtle bg-surface-1 px-3 py-1 text-xs font-semibold text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
              >
                Add to my notes
              </button>
            )}
            <button onClick={() => setEntityPrompt(null)} className="text-text-muted hover:text-text-secondary">✕</button>
          </span>
        </div>
      )}

      {toast && (
        <div className="mx-auto mt-3 flex max-w-3xl items-center justify-between rounded-lg border border-brand-green/30 bg-brand-light-bg px-3 py-2 text-sm text-brand-dark-green">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-brand-dark-green/60 hover:text-brand-dark-green">✕</button>
        </div>
      )}

      {/* Context tree — rendered INTO the global Sidebar's docked card (it owns the
          rail + tree container chrome); we just supply the tree content via a portal.
          host is null when the dock isn't open (undocked, collapsed, or below lg). */}
      {host && !collapsed && tree &&
        createPortal(
          // Fade the tree in: the Sidebar column unfolds as soon as the dock is
          // requested, but this content lands once its data resolves — the fade
          // smooths that arrival.
          <div className="h-full min-h-0" style={{ animation: 'fadeIn 0.3s ease-out' }}>
            <NoteSidebar
              bare
              tree={tree}
              notes={notes}
              pinned={pinned}
              selectedPath={selectedPath}
              canEdit
              onSelect={openNote}
              onTogglePin={handleTogglePin}
              onDeleteNote={handleDelete}
              folderBadges={folderBadges}
              onFolderAccess={!isPersonalSpace ? (folderId) => setFolderAccess({ folderId }) : undefined}
            />
          </div>,
          host,
        )}

      {/* Editor view is full-bleed: the −mt-24 cancels the auth shell's top
          offset (main mt-20 + pt-4 = 96px) so the note scrolls up behind the
          translucent fixed navbar (z-50) instead of stopping below it. Its height
          spans to ~viewport bottom; the editor floats its own toolbar over the
          note. Search/Graph keep the boxed surface below the navbar. */}
      {(view === 'editor' || view === 'raw') && selectedPath ? (
        <div
          className={embedded ? 'relative min-h-0 flex-1' : 'relative -mt-24'}
          style={embedded ? undefined : { height: 'calc(100dvh - 16px)' }}
        >
          <NoteEditor
            key={selectedPath}
            variant={embedded ? 'boxed' : 'floating'}
            path={selectedPath}
            meta={selectedMeta}
            notes={noteRefs}
            initialContent={content}
            canEdit
            aiConfigured={aiConfigured}
            mode={view === 'raw' ? 'raw' : 'wysiwyg'}
            references={references}
            related={related}
            entities={entities}
            entityByPath={entityByPath}
            onEnsureEntityNote={onEnsureEntityNote}
            onSave={handleSave}
            onOpenNote={openNote}
            onShowHistory={() => setHistoryOpen(true)}
            exportHref={notesApi.exportUrl(communityId!, selectedPath)}
            onDelete={() => handleDelete(selectedPath)}
          />
        </div>
      ) : (
        <div className="mt-3 flex min-h-0 flex-1 pb-4 pr-4 sm:pr-6 lg:pr-8">
          <main className="min-w-0 flex-1 overflow-hidden">
            {view === 'graph' ? (
              <div className="relative h-full">
                {/* Search floats on top of the graph (centred near the top). The wrapper
                    is click-through so graph panning still works around the box; only the
                    box + its results dropdown capture pointer events. */}
                <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4">
                  <div className="pointer-events-auto w-full max-w-2xl">
                    <NoteSearchBox
                      notes={notes}
                      onOpen={openNote}
                      serverSearch={serverSearch}
                      placeholder={searchPlaceholder}
                    />
                  </div>
                </div>
                {graphData ? (
                  <NotesGraph
                    graph={graphData.graph}
                    selectedPath={selectedPath}
                    onOpenNote={openNote}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-text-muted">Loading graph…</div>
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                <p className="text-base font-semibold text-text-secondary">Select a note to start editing</p>
              </div>
            )}
          </main>
        </div>
      )}

      {createKind && (
        <CreateModal
          kind={createKind}
          folders={folders}
          defaultFolder={selectedPath && selectedPath.includes('/') ? selectedPath.slice(0, selectedPath.lastIndexOf('/')) : ''}
          onSubmit={handleCreate}
          onClose={() => setCreateKind(null)}
        />
      )}

      {quickOpen && (
        <NotePicker
          notes={noteRefs}
          placeholder="Jump to note…"
          onPick={(path) => {
            openNote(path)
            setQuickOpen(false)
          }}
          onClose={() => setQuickOpen(false)}
        />
      )}

      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}

      {historyOpen && communityId && selectedPath && (
        <RevisionHistory
          communityId={communityId}
          path={selectedPath}
          onRestored={() => loadIndex(false)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {trashOpen && communityId && (
        <TrashModal
          communityId={communityId}
          onChanged={() => loadIndex(true)}
          onClose={() => setTrashOpen(false)}
        />
      )}

      {reorganizeOpen && communityId && (
        <ReorganizeModal
          communityId={communityId}
          onApplied={() => loadIndex(true)}
          onClose={() => setReorganizeOpen(false)}
        />
      )}

      {folderAccess && communityId && (
        <FolderAccessModal
          communityId={communityId}
          topLevelFolders={topLevelFolders}
          initialFolderId={folderAccess.folderId}
          onRegistryChanged={refreshRegistry}
          onClose={() => setFolderAccess(null)}
        />
      )}

      {promoteOpen && selectedPath && (
        <PromoteDialog
          targetCommunities={promoteTargets}
          fromPath={selectedPath}
          onClose={() => setPromoteOpen(false)}
        />
      )}

      {captureOpen && communityId && (
        <CaptureBox
          communityId={communityId}
          personal={isPersonalSpace}
          onOpenLog={isPersonalSpace ? handleOpenLog : undefined}
          onClose={() => setCaptureOpen(false)}
        />
      )}

      {healthOpen && communityId && (
        <BrainHealthModal
          communityId={communityId}
          isPersonalSpace={isPersonalSpace}
          aiConfigured={aiConfigured}
          isCommunityAdmin={isCommunityAdmin}
          onChanged={() => loadIndex(false)}
          onClose={() => setHealthOpen(false)}
        />
      )}
    </div>
  )
}

function GhostAction({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted transition hover:bg-surface-2 hover:text-text-secondary"
    >
      {children}
    </button>
  )
}
