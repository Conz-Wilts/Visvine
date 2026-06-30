'use client'

// The notes workspace: orchestrates the brain toggle (personal vs shared),
// the sidebar tree, the editor, and the backlinks/related rail. Owns all data
// loading (plain fetch + state, Visvine convention) and refreshes the index
// after mutations. Markdown is the source of truth end to end.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { useContextPanel } from '@/lib/contexts/ContextPanelContext'
import { useHeader } from '@/lib/contexts/HeaderContext'
import { useCommunityGraphData } from '@/hooks/useCommunityGraphData'
import { ViewToggle, type ViewToggleOption } from '@/components/ui'
import { entityNotePath, entityStub, entityKindOfPath } from '@/lib/notes/entities'
import { notesApi, type Scope } from '../lib/notesApi'
import { NoteSidebar } from './NoteSidebar'
import { NoteEditor } from './NoteEditor'
import { NoteSearchBox } from './NoteSearchBox'
import { NotePicker, type PickerEntity } from './NotePicker'
import { CreateModal } from './CreateModal'
import { NotesGraph } from './NotesGraph'
import { CommandPalette, type Command } from './CommandPalette'
import { RevisionHistory } from './RevisionHistory'
import { TrashModal } from './TrashModal'
import { ReorganizeModal } from './ReorganizeModal'
import type { NoteMeta, TreeNode, References, RelatedNote, GraphData } from '@/lib/notes/shared/types'
import type { LinkInsights } from '@/lib/notes/shared/insights'
import '../notes.css'

const SCOPE_KEY = 'visvine.notes.scope'

// The Context tree no longer positions itself: the global Sidebar owns a full-height
// docked card on /context and exposes a portal host (ContextPanelContext) where we
// mount <NoteSidebar>, so the icon rail + tree read as one container. We only reserve
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

export function NotesWorkspace() {
  const { currentCommunity } = useCommunity()
  const { host, collapsed, setCollapsed } = useContextPanel()
  const { setHeaderRight, setHeaderContent } = useHeader()
  const { graphData: directoryGraph } = useCommunityGraphData()
  const communityId = currentCommunity?.id ?? null
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Directory entities (person/org nodes) usable in `[[ ]]` mentions: the picker
  // list + a path→entity map the chip decoration reads. Built from the cached
  // community graph (all nodes), keyed by each entity's canonical note path.
  const { entities, entityByPath } = useMemo(() => {
    const list: PickerEntity[] = []
    const map = new Map<string, PickerEntity>()
    for (const n of directoryGraph.nodes) {
      const path = entityNotePath({ id: n.id, type: n.type })
      if (!path) continue
      const e: PickerEntity = {
        id: n.id,
        name: n.name,
        type: n.type,
        image_url: n.image_url ?? null,
        subtitle: n.subtitle ?? null,
      }
      list.push(e)
      map.set(path, e)
    }
    return { entities: list, entityByPath: map }
  }, [directoryGraph])

  const [scope, setScope] = useState<Scope>('shared')
  const [aiConfigured, setAiConfigured] = useState(false)

  const [tree, setTree] = useState<TreeNode | null>(null)
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [pinned, setPinned] = useState<string[]>([])
  // The open note carries its OWN brain (scope), captured at open time, so an entity
  // note can open from the shared brain while you browse your personal one. Entity
  // context notes are community-canonical: opening one that isn't in the current brain
  // resolves to `shared` (see scopeForPath). selectedPath/openScope derive from this.
  const [open, setOpen] = useState<{ path: string; scope: Scope } | null>(null)
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
  // Post-create "also keep a personal copy?" prompt, and a transient neutral toast.
  const [entityPrompt, setEntityPrompt] = useState<{ path: string; name: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // The open note's path + the brain it lives in (see `open` above).
  const selectedPath = open?.path ?? null
  const openScope: Scope = open?.scope ?? scope

  // Latest directory map, read by the load effect's self-heal without making it a
  // dependency (so the open note isn't re-read every time the directory graph loads).
  const entityByPathRef = useRef(entityByPath)
  entityByPathRef.current = entityByPath

  // The brain an entity note resolves to: the current brain when it has the note,
  // else the canonical shared brain. Non-entity notes always use the current brain.
  const scopeForPath = useCallback(
    (path: string): Scope =>
      entityKindOfPath(path) && !notes.some((n) => n.path === path) ? 'shared' : scope,
    [notes, scope],
  )

  const loadSeq = useRef(0)
  const noteRefs = useMemo(() => notes.map((n) => ({ path: n.path, title: n.title })), [notes])
  const folders = useMemo(() => collectFolderPaths(tree), [tree])
  const selectedMeta = useMemo(
    () => notes.find((n) => n.path === selectedPath) ?? null,
    [notes, selectedPath],
  )

  // Arriving with ?new=note (e.g. from the global "Create new → Context" tile)
  // auto-opens the New-note dialog, then clears the param so it fires once.
  // Reactive (not mount-only) so it works even when already on /context.
  useEffect(() => {
    if (searchParams.get('new') === 'note') {
      setCreateKind('note')
      router.replace(pathname)
    }
  }, [searchParams, pathname, router])

  // Restore the last brain choice.
  useEffect(() => {
    const saved = localStorage.getItem(SCOPE_KEY)
    if (saved === 'shared' || saved === 'personal') setScope(saved)
  }, [])

  // AI availability (once).
  useEffect(() => {
    notesApi.config().then((c) => setAiConfigured(c.aiConfigured)).catch(() => {})
  }, [])

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
          notesApi.list(communityId, scope),
          notesApi.tree(communityId, scope),
        ])
        setNotes(list.notes)
        setPinned(list.pinned)
        setTree(treeRes.tree)
        if (autoSelect) {
          // Auto-selection picks from the just-loaded browsing list, so the note
          // lives in the current brain → open it under the current scope.
          setOpen((cur) => {
            const keep = cur && list.notes.some((n) => n.path === cur.path) ? cur.path : null
            const next =
              keep ?? list.notes.find((n) => n.path.toLowerCase() === 'welcome.md')?.path ?? list.notes[0]?.path ?? null
            return next ? { path: next, scope } : null
          })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notes')
      } finally {
        setLoading(false)
      }
    },
    [communityId, scope],
  )

  // Reload the index whenever the community or brain changes, landing on the
  // graph screen with no note open (notes are opened from there).
  useEffect(() => {
    setOpen(null)
    setContent('')
    setReferences(null)
    setRelated(null)
    setView('graph')
    loadIndex(false)
  }, [loadIndex])

  // Open a note into the editor (the one entry point used by search, the sidebar,
  // pickers, the graph, and in-note links). An entity note absent from the current
  // brain resolves to the canonical shared note (scopeForPath). Drop any stale error
  // so a leftover toast (e.g. from a prior failed open) doesn't follow you on.
  const openNote = useCallback(
    (path: string) => {
      setError(null)
      setOpen({ path, scope: scopeForPath(path) })
      setView('editor')
    },
    [scopeForPath],
  )

  // Load the open note's content + references + related, from the brain captured in
  // `open` (which may differ from the browsing scope for a shared entity note).
  useEffect(() => {
    if (!communityId || !open) {
      setContent('')
      setReferences(null)
      setRelated(null)
      return
    }
    const seq = ++loadSeq.current
    const { path, scope: sc } = open
    // Clear the previous note's body up front so a slow/failed open never shows a
    // ghost of the note you came from under the new heading.
    setContent('')
    setReferences(null)
    setRelated(null)
    notesApi
      .read(communityId, sc, path)
      .then(({ content: c }) => {
        if (loadSeq.current === seq) {
          setContent(c)
          setError(null) // a successful open clears any stale error toast
        }
      })
      .catch(async (err) => {
        if (loadSeq.current !== seq) return
        // Self-heal: a directory entity can lack a seeded shared note. If this is a
        // known entity resolved to shared, create its stub from the directory entity
        // and re-read once before surfacing an error.
        const entity = sc === 'shared' ? entityByPathRef.current?.get(path) : undefined
        if (entity) {
          try {
            await notesApi.create(communityId, 'shared', path, entityStub(entity))
          } catch {
            /* tolerate already-exists / a concurrent create */
          }
          try {
            const { content: c } = await notesApi.read(communityId, 'shared', path)
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
    notesApi.references(communityId, sc, path).then(({ references: r }) => {
      if (loadSeq.current === seq) setReferences(r)
    }).catch(() => {})
    notesApi.related(communityId, sc, path).then(({ related: r }) => {
      if (loadSeq.current === seq) setRelated(r)
    }).catch(() => {})
  }, [communityId, open])

  const changeScope = (next: Scope) => {
    if (next === scope) return
    localStorage.setItem(SCOPE_KEY, next)
    // Clear the open note (and any stale error) in the SAME batched update as the
    // scope flip, so the note-load effect never fires the old path against the new
    // brain. Without this, switching while a brain-specific note is open (e.g. the
    // Community-only `companies/index.md`) reads it from the other brain and 404s
    // ("Note not found: …"). The new brain's index loads via the loadIndex effect.
    setOpen(null)
    setContent('')
    setReferences(null)
    setRelated(null)
    setView('graph')
    setError(null)
    setScope(next)
  }

  // Persist an edit, then refresh the index + the open note's references/related
  // (links/tags may have changed). Does NOT touch `content`, so the editor keeps
  // its cursor — initialContent only changes on a note switch.
  const handleSave = useCallback(
    async (path: string, body: string, origin?: string) => {
      if (!communityId) return
      // Write to the open note's brain (shared for a cross-brain entity note); the
      // sidebar index still refreshes for the brain you're browsing.
      const sc = open && open.path === path ? open.scope : scope
      try {
        await notesApi.write(communityId, sc, path, body, origin)
        const [list, treeRes] = await Promise.all([
          notesApi.list(communityId, scope),
          notesApi.tree(communityId, scope),
        ])
        setNotes(list.notes)
        setPinned(list.pinned)
        setTree(treeRes.tree)
        if (open?.path === path) {
          notesApi.references(communityId, sc, path).then(({ references: r }) => setReferences(r)).catch(() => {})
          notesApi.related(communityId, sc, path).then(({ related: r }) => setRelated(r)).catch(() => {})
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    },
    [communityId, scope, open],
  )

  // Ensure a directory entity's context note exists, then return its path. Picking
  // `[[Craig Piggott]]` calls this before inserting the link, so the mention always
  // resolves to a real note (graph + backlinks light up). Entity notes are
  // community-canonical, so they're created in the SHARED brain by default; when a
  // note is newly created we offer to also keep a personal copy.
  const onEnsureEntityNote = useCallback(
    async (entity: PickerEntity): Promise<string> => {
      const path = entityNotePath({ id: entity.id, type: entity.type })
      if (!path) throw new Error('Not a directory entity')
      if (!communityId) throw new Error('No community')
      let created = false
      try {
        await notesApi.create(communityId, 'shared', path, entityStub(entity))
        created = true
      } catch (err) {
        // Tolerate a note that already exists (seeded / created elsewhere).
        if (!(err instanceof Error && /already exists/i.test(err.message))) throw err
      }
      if (created) {
        // Reflect the new shared note in the sidebar if you're browsing the shared brain.
        if (scope === 'shared') await loadIndex(false)
        setEntityPrompt({ path, name: entity.name })
      }
      return path
    },
    [communityId, scope, loadIndex],
  )

  // Keep a private copy of an entity note in the user's personal brain (a fresh stub,
  // separate from the shared writeup). Tolerant of one already existing.
  const onAddToPersonal = useCallback(
    async (path: string) => {
      if (!communityId) return
      const entity = entityByPath.get(path)
      if (!entity) return
      setEntityPrompt(null)
      try {
        await notesApi.create(communityId, 'personal', path, entityStub(entity))
        setToast(`Added ${entity.name} to your personal brain`)
        if (scope === 'personal') await loadIndex(false)
      } catch (err) {
        if (err instanceof Error && /already exists/i.test(err.message)) {
          setToast(`${entity.name} is already in your notes`)
        } else {
          setError(err instanceof Error ? err.message : 'Failed to add to your personal brain')
        }
      }
    },
    [communityId, scope, entityByPath, loadIndex],
  )

  const handleCreate = async (name: string, folder: string) => {
    if (!communityId || !createKind) return
    try {
      if (createKind === 'note') {
        const slug = slugify(name)
        const path = folder ? `${folder}/${slug}.md` : `${slug}.md`
        await notesApi.create(communityId, scope, path, defaultNoteContent(name))
        await loadIndex(false)
        openNote(path)
      } else {
        const path = folder ? `${folder}/${slugify(name)}` : slugify(name)
        await notesApi.createFolder(communityId, scope, path)
        await loadIndex(false)
      }
      setCreateKind(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  const handleDelete = async (path: string) => {
    if (!communityId) return
    const sc = open && open.path === path ? open.scope : scope
    try {
      await notesApi.remove(communityId, sc, path)
      if (open?.path === path) {
        setOpen(null)
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
      await notesApi.pin(communityId, scope, path, pin)
    } catch {
      // revert on failure
      setPinned((cur) => (pin ? cur.filter((p) => p !== path) : [...cur, path]))
    }
  }

  // Load graph data when the graph view is active (and on scope/community change).
  useEffect(() => {
    if (view !== 'graph' || !communityId) return
    let alive = true
    notesApi
      .graph(communityId, scope)
      .then(({ graph, insights }) => {
        if (alive) setGraphData({ graph, insights })
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load graph')
      })
    return () => {
      alive = false
    }
  }, [view, communityId, scope, notes])

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
      { id: 'brain', label: scope === 'shared' ? 'Switch to my notes' : 'Switch to community brain', run: () => { setPaletteOpen(false); changeScope(scope === 'shared' ? 'personal' : 'shared') } },
      { id: 'trash', label: 'Open trash', run: () => { setPaletteOpen(false); setTrashOpen(true) } },
    ]
    if (selectedPath) {
      list.push({ id: 'history', label: 'Version history of this note', run: () => { setPaletteOpen(false); setHistoryOpen(true) } })
    }
    if (aiConfigured) {
      list.push({ id: 'reorganize', label: 'Reorganize notes with AI', run: () => { setPaletteOpen(false); setReorganizeOpen(true) } })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scope, selectedPath, aiConfigured])

  // The Graph/Editor/Raw view selector lives in the navbar, to the left of the
  // profile icon — sharing the directory's animated brand-green ViewToggle so the
  // two read as the same control. Editor/Raw only appear once a note is open.
  useEffect(() => {
    const viewOptions: ViewToggleOption<'graph' | 'editor' | 'raw'>[] = [
      { id: 'graph', label: 'Graph' },
    ]
    if (selectedPath) {
      viewOptions.push({ id: 'editor', label: 'Editor' }, { id: 'raw', label: 'Raw' })
    }
    setHeaderRight(<ViewToggle options={viewOptions} value={view} onChange={setView} />)
    return () => setHeaderRight(null)
  }, [view, selectedPath, setHeaderRight])

  // The brain (scope) toggle + Reorganize action ride in the navbar's centre slot
  // rather than a page row, so the editor sits flush under the navbar with no
  // intervening chrome for the note text to scroll behind.
  useEffect(() => {
    setHeaderContent(
      <div className="flex items-center justify-center gap-2">
        <div className="relative flex items-center gap-1 rounded-2xl border border-border-default bg-surface-1 p-1 shadow-float">
          <BrainTab label="My notes" active={scope === 'personal'} onClick={() => changeScope('personal')} />
          <BrainTab label="Community brain" active={scope === 'shared'} onClick={() => changeScope('shared')} />
        </div>
        {aiConfigured && (
          <GhostAction onClick={() => setReorganizeOpen(true)} title="Reorganize with AI">✨ Reorganize</GhostAction>
        )}
      </div>,
    )
    return () => setHeaderContent(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, aiConfigured, setHeaderContent])

  if (!currentCommunity) {
    return (
      <div className="flex h-[calc(100dvh-56px)] w-full items-center justify-center">
        <p className="text-text-muted">Select a community to view notes.</p>
      </div>
    )
  }

  const heading = scope === 'shared' ? 'Community brain' : 'My notes'

  // Reserve the editor's left padding so it clears the Sidebar's docked tree card.
  // Both literals must stay verbatim so Tailwind's JIT emits them.
  const contentPad = collapsed ? 'lg:pl-[52px]' : 'lg:pl-[268px]'

  return (
    <div className={`relative flex h-[calc(100dvh-120px)] w-full flex-col ${contentPad}`}
      style={{ transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)' }}
    >
      {error && (
        <div className="mx-auto mt-3 flex max-w-3xl items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* After a new entity note is saved to the shared directory, offer a personal copy. */}
      {entityPrompt && (
        <div className="mx-auto mt-3 flex max-w-3xl items-center justify-between gap-3 rounded-lg border border-border-default bg-surface-1 px-3 py-2 text-sm text-text-secondary shadow-soft">
          <span>
            Added <span className="font-semibold text-text-primary">{entityPrompt.name}</span> to the community directory.
          </span>
          <span className="flex flex-none items-center gap-1.5">
            <button
              onClick={() => onAddToPersonal(entityPrompt.path)}
              className="rounded-full border border-border-subtle bg-surface-1 px-3 py-1 text-xs font-semibold text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
            >
              Add to my notes
            </button>
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
          host is null off /context, when collapsed, or below lg (no docked card). */}
      {host && !collapsed && tree &&
        createPortal(
          // Fade the tree in: the Sidebar column unfolds immediately on /context, but
          // this content lands once its data resolves — the fade smooths that arrival.
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
        <div className="relative -mt-24" style={{ height: 'calc(100dvh - 16px)' }}>
          <NoteEditor
            key={`${openScope}:${selectedPath}`}
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
            onAddToPersonal={onAddToPersonal}
            onSave={handleSave}
            onOpenNote={openNote}
            onShowHistory={() => setHistoryOpen(true)}
            exportHref={notesApi.exportUrl(communityId!, openScope, selectedPath)}
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
                  <div className="pointer-events-auto w-full max-w-md">
                    <NoteSearchBox
                      notes={notes}
                      onOpen={openNote}
                      placeholder={scope === 'shared' ? `Search ${heading}…` : 'Search your notes…'}
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
          scope={openScope}
          path={selectedPath}
          onRestored={() => loadIndex(false)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {trashOpen && communityId && (
        <TrashModal
          communityId={communityId}
          scope={scope}
          onChanged={() => loadIndex(true)}
          onClose={() => setTrashOpen(false)}
        />
      )}

      {reorganizeOpen && communityId && (
        <ReorganizeModal
          communityId={communityId}
          scope={scope}
          onApplied={() => loadIndex(true)}
          onClose={() => setReorganizeOpen(false)}
        />
      )}
    </div>
  )
}

// Brain (scope) toggle — matches the directory view selector's bordered green-pill style.
function BrainTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative z-10 flex h-10 items-center rounded-xl px-3 text-xs font-semibold transition-colors duration-200 ${
        active ? 'bg-brand-green text-white shadow-sm' : 'text-text-muted hover:text-text-secondary'
      }`}
    >
      {label}
    </button>
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
