'use client'

// The notes sidebar: a folder/note tree. Two marks, and only two: a folder is
// a folder and a note is a document. A row's type, its tool and the space it
// belongs to are all said by where it sits and what it is called, so a glyph
// per kind only made the column harder to scan. Row actions (share, delete)
// live behind a single menu revealed on hover; MOVING is a drag, and only a
// drag — pick a row up and drop it anywhere in the column (useTreeDrag).
// Nesting is shown
// with tree guides: each nested row draws its own segment of the vertical line
// plus an elbow into its icon, and the last child of a folder closes the line
// off with a rounded corner, so depth reads at a glance. Expanding a folder puts
// its rows on screen immediately (see `Branch`). The tree scrolls with
// its scrollbar on the right (normal) edge. A Trash folder is pinned below everything: deleted
// notes live there for a week (restore or delete-forever from the row menu)
// before the server purges them.

import { Fragment, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TreeNode, TrashEntry } from '@/lib/notes/shared/types'
import { TRASH_RETENTION_DAYS } from '@/lib/notes/shared/types'
import {
  TreeBranch as Branch,
  TreeFileIcon as FileIcon,
  TreeFolderIcon as FolderIcon,
  TreeGuide as GuideLine,
  TreeGuideRun,
  TreeStem,
  TREE_CHILD_INDENT as CHILD_INDENT,
  TREE_NESTED_CHILD_INDENT as NESTED_CHILD_INDENT,
  TREE_ROW_BLEED as ROW_BLEED,
  type TreeGuideKind as Guide,
} from '@/components/ui/TreeChrome'
import { isEntityFolderIndex } from '@/lib/notes/entities'
import { filterTree, folderPathsIn } from '@/lib/notes/shared/context'
import { tierRoot } from '@/lib/notes/shared/rootTiers'
import { drawnChain, focusFor, focusUp, maxRowDepthFor } from '@/lib/notes/shared/treeFocus'
import {
  TRASH_PATH,
  treeScrollMemory as scrollMemory,
  useContextTreeState,
} from '@/features/notes/hooks/useContextTreeState'
import { canMoveInto, deleteFolderDenial, moveDenial, parentFolderOf } from '../lib/useContextTree'
import { SUBSPACE_FOLDER, isFederatedPath, subspaceOfPath } from '@/lib/spaces/subspaces'
import { canPlaceInto, drawnParentOf, placeableOf, placementDenial } from '@/lib/notes/shared/placedFolders'
import { orderKeyOf } from '@/lib/notes/shared/folderOrder'
import { indexPathOf } from '@/lib/notes/shared/indexNote'
import { Icon } from '@/features/shared/icons'
import { useTreeDrag, type DropVerdict, type TreeDragItem, type TreeSlot } from '../hooks/useTreeDrag'
import { useTreeFlip } from '../hooks/useTreeFlip'
import type { DropOrder, MoveLabels, MoveOutcome } from '../lib/useContextTree'

// Expansion state (openPaths + reveal overlay + persistence) lives in
// useContextTreeState, shared with the full-screen Context explorer so both
// surfaces read and write the same per-space blob.
/** Is `path` the open note, or the folder that contains it? */
function onSelectedPath(path: string, selectedPath: string | null): boolean {
  if (!selectedPath) return false
  return selectedPath === path || selectedPath.startsWith(`${path}/`)
}

/** Access adornments for a folder row at ANY depth (shared context only):
 *  restricted = a grant boundary (ðŸ”’), plus the viewer's own level chip. */
interface FolderBadge {
  restricted: boolean
  locked?: boolean
  /** The viewer's own effective level at the folder ('view' or 'edit'). */
  level?: string
}

type MovableItem = TreeDragItem

/** Drag-to-move, shared with every row rather than threaded through the
 *  recursive Tree/FolderRow props (they already carry a dozen). Null when the
 *  host surface passed no move handlers — rows then can't be picked up at all. */
interface TreeDragValue {
  dragging: MovableItem | null
  /** Where the held row would drop: the place between rows the tree keeps open
   *  for it (useTreeDrag). Null when it has none — over a shut folder, or a row
   *  with no place of its own held somewhere it may not go. */
  slot: TreeSlot | null
  /** The SHUT folder a drop right now would file into — it lights up, since
   *  there is nowhere inside it to show a slot. */
  intoFolder: string | null
  /** Whether the held row is off the tree (in hand) — so it leaves home. */
  away: boolean
  /** The drop is made and the move is running: the slot shows the row itself. */
  dropped: boolean
  /** Whether the host surface places structural folders at all. */
  canPlace: boolean
  /** A row's onPointerDown — the drag starts once the pointer travels. */
  press: (item: MovableItem, e: React.PointerEvent<HTMLElement>) => void
}

/** Whether `item` may be dropped into `dest` — a placement or a move, by the
 *  item's kind — and, when it may not, what to say about it. Already being
 *  there is a quiet no, and so is a folder held over its own subtree: that is
 *  where every drag of it starts. */
function dropVerdict(tree: TreeNode, item: MovableItem, dest: string, canOrder: boolean): DropVerdict {
  // Home: the folder is not changing, only the row's place in it.
  if (canOrder && dest !== SUBSPACE_FOLDER && drawnParentOf(tree, item.path) === dest) return { ok: true }
  const ok =
    item.kind === 'placed'
      ? canPlaceInto(tree, item.path, dest)
      : canMoveInto(item.path, item.kind, dest, item.declares)
  if (ok) return { ok: true }
  if (item.kind !== 'note' && (dest === item.path || dest.startsWith(`${item.path}/`))) return { ok: false, reason: null }
  return {
    ok: false,
    reason:
      item.kind === 'placed'
        ? placementDenial(item.path, dest, tree)
        : moveDenial(item.path, item.kind, dest, item.declares),
  }
}

/** The folder node at `path` wherever the tree DRAWS it — a placed folder is
 *  not under its path-parent. */
function folderNodeIn(node: TreeNode, path: string): TreeNode | null {
  if (node.path === path) return node
  for (const child of node.children ?? []) {
    if (child.kind !== 'folder') continue
    const hit = folderNodeIn(child, path)
    if (hit) return hit
  }
  return null
}

/** The `order:` list that puts `item` at `index` among `folder`'s rows — the
 *  rows as Tree draws them: no home note, no held row. */
function orderWith(tree: TreeNode, folder: string, item: string, index: number): DropOrder {
  const own = indexPathOf(folder)
  const rows = (folderNodeIn(tree, folder)?.children ?? [])
    .filter((c) => c.path !== item && !(c.kind === 'note' && c.path === own))
    .map((c) => orderKeyOf(folder, c.path))
  return (landed) => {
    const key = orderKeyOf(folder, landed)
    const rest = rows.filter((k) => k !== key)
    return [...rest.slice(0, index), key, ...rest.slice(index)]
  }
}

/** What a folder is called in the tree ('' and anything unfound → null). */
function folderLabelIn(node: TreeNode, path: string): string | null {
  for (const child of node.children ?? []) {
    if (child.kind !== 'folder') continue
    if (child.path === path) return child.title ?? child.name
    if (path.startsWith(`${child.path}/`)) return folderLabelIn(child, path)
  }
  return null
}

const TreeDrag = createContext<TreeDragValue | null>(null)

/** The path a drop just landed at — its row glows there for a moment. */
const TreeLanded = createContext<string | null>(null)

/** Entering a sub-space read into this tree — switching to it, not opening a
 *  folder. Carried on a context for the reason TreeDrag is: the row that needs
 *  it sits at the end of a recursion whose props are already long. */
const TreeEnterSpace = createContext<((spaceId: string) => void) | null>(null)

/** The sub-spaces the viewer stands in, read off the grafted folders' `writable`
 *  stamp (lib/spaces/subspaces.ts#graftSubspace). Rows under one of these take
 *  the same edit affordances as the space's own — the server judges each write
 *  in the sub-space — and rows under any other federated folder are read-only. */
const TreeWritableSpaces = createContext<ReadonlySet<string>>(new Set())

/** Whether a row is another space's context the viewer can only read here:
 *  what the parent shares (`parent/`), or a sub-space they are not in. */
function readOnlyHere(path: string, writable: ReadonlySet<string>): boolean {
  if (!isFederatedPath(path)) return false
  const sub = subspaceOfPath(path)
  return sub === null || !writable.has(sub)
}

/** Whether a row can be dragged at all: moving it to the folder it already sits
 *  in is a no-op, so a denial there is purely about the item itself (entity
 *  note, folder index, managed namespace). */
function isMovable(path: string, kind: 'note' | 'folder', declares?: 'connector' | 'model'): boolean {
  return moveDenial(path, kind, parentFolderOf(path), declares) === null
}

interface NoteSidebarProps {
  tree: TreeNode
  selectedPath: string | null
  canEdit: boolean
  /** `page` is set when the space's own row is pressed: that opens the space's
   *  Page, where `Main` (the same note) opens its context alone. */
  onSelect: (path: string, opts?: { page?: boolean }) => void
  onDeleteNote: (path: string) => void
  /** Access badges keyed by FULL path â€” folders AND privately-restricted notes
   *  (shared scope only). */
  folderBadges?: Map<string, FolderBadge>
  /** Hover action on folder rows: open the folder's Share panel. */
  onFolderAccess?: (folderPath: string) => void
  /** â‹¯ menu action on note rows: open the note's Share panel. */
  onShareNote?: (path: string) => void
  /** â‹¯ menu action on folder rows: delete the folder (and the notes inside). */
  onDeleteFolder?: (folderPath: string, label?: string) => void
  /** File a note into another folder ('' = the context root). Passing both move
   *  handlers turns on dragging; omit them for a read-only tree. Authority
   *  stays server-side — a rejected move comes back as a `failed` outcome and
   *  the tree says why. The handler may hold the drop open to ask first (a move
   *  that changes who can see the item), which is why it answers with a promise. */
  onMoveNote?: (from: string, destFolder: string, labels: MoveLabels, order?: DropOrder) => Promise<MoveOutcome>
  /** Move a folder and everything under it. */
  onMoveFolder?: (from: string, destFolder: string, labels: MoveLabels, order?: DropOrder) => Promise<MoveOutcome>
  /** Place a built-in folder or a sub-space under a folder of the space's own
   *  ('' = the top): the path stays, the tree draws it there
   *  (lib/notes/shared/placedFolders.ts). Omit and those rows don't drag. */
  onPlaceFolder?: (path: string, destFolder: string, order?: DropOrder) => Promise<MoveOutcome>
  /** Keep the order a folder's rows were dragged into ('' = the top): nothing
   *  moves, the folder's index note records it (lib/notes/shared/folderOrder.ts).
   *  Omit and a drag only changes folders — rows stay sorted by name. */
  onOrderFolder?: (folder: string, order: string[], path: string) => Promise<MoveOutcome>
  /** Render without card chrome (bg/border/shadow) â€” used when the sidebar sits on
   *  the shared dock backdrop, which already supplies the background and shadow. */
  bare?: boolean
  /** Show the context root as a real (collapsible) folder row at the top of the
   *  tree instead of a separate header bar, so the space reads as the parent
   *  folder of everything below it. `icon` replaces the folder glyph; the root
   *  row shows no glyph at all when it's omitted. */
  root?: { label: string; icon?: React.ReactNode }
  /** Scopes the persisted expand/collapse state (pass the space id). Omit to
   *  keep the state in memory only. */
  storageKey?: string | null
  /** Soft-deleted notes for this context, shown as a Trash folder pinned to the
   *  bottom of the tree. Omit (or pass null) to hide the row entirely. */
  trash?: TrashEntry[] | null
  /** Trash row actions. Restore puts the note back at its original path;
   *  purge/empty delete permanently, ahead of the retention window. */
  onRestoreTrash?: (id: string) => void
  onPurgeTrash?: (id: string) => void
  onEmptyTrash?: () => void
  /** Open a trashed note's read-only preview. Omit to leave trash rows as
   *  plain labels. */
  onOpenTrash?: (entry: TrashEntry) => void
  /** Note to temporarily expand the tree down to (the context search's focused
   *  match, or the note a profile page has open). Unlike a click this never
   *  changes the saved expansion â€” clearing it collapses the peek back to
   *  whatever the user had open. */
  revealPath?: string | null
  /** Switching to a sub-space whose context is read into this tree. The room's
   *  folder row offers it as "Open <room>", because expanding the folder and
   *  standing in the room are two different things and the row is the only
   *  place they look alike. Omit and the row simply doesn't offer it. */
  onEnterSpace?: (spaceId: string) => void
  /** The Directory's search box, applied to the tree: the tree is pruned to
   *  what matches and every surviving folder is opened, so a match is never
   *  hidden inside a collapsed ancestor. Trash steps aside while it runs -
   *  a search says "here is what matches", not "here is everything plus
   *  what matches". */
  query?: string
}

export function NoteSidebar({
  tree,
  selectedPath,
  canEdit,
  onSelect,
  onDeleteNote,
  folderBadges,
  onFolderAccess,
  onShareNote,
  onDeleteFolder,
  onMoveNote,
  onMoveFolder,
  onPlaceFolder,
  onOrderFolder,
  trash = null,
  onRestoreTrash,
  onPurgeTrash,
  onEmptyTrash,
  onOpenTrash,
  bare = false,
  root,
  storageKey = null,
  revealPath = null,
  query = '',
  onEnterSpace,
}: NoteSidebarProps) {
  const searching = query.trim().length > 0

  // The rooms whose rows take this space's edit affordances. Read off the
  // `writable` stamp, and read at the top level ONLY: a room's folder is a
  // child of `Sub-spaces`, so today this set is empty and every row of another
  // space's context is read-only here. That is the rule the tree means —
  // you read a room here and work in it there ("Open <room>" on its row) —
  // and this is where to look when it should stop being.
  const writableSpaces = useMemo(
    () => new Set((tree.children ?? []).filter((c) => c.space && c.writable).map((c) => c.space!)),
    [tree],
  )

  // Which folders are expanded â€” persisted per scope, with the reveal peek
  // layered on top (see useContextTreeState for the full story).
  const { effectiveOpenPaths, toggleFolder, openFolder } = useContextTreeState(storageKey, revealPath)

  // Searching is a peek, like the reveal: it never writes the saved expansion,
  // so clearing the box puts the tree back exactly as the user left it.
  // Tiered LAST, over whatever the search left: `Main` and the rooms are how
  // the root is drawn, not what the tree holds, so every read of a real path —
  // the search prune, the drag rules — still sees the
  // tree the server sent (lib/notes/shared/rootTiers.ts).
  const shownTree = useMemo(
    () => tierRoot(searching ? filterTree(tree, query) : tree),
    [tree, query, searching],
  )
  // Folders a drag has sprung open are a peek too: open while the pointer is
  // in them, shut again once it has left, and never written to the saved
  // expansion — only the folder a drop actually lands in is opened for good.
  const [sprung, setSprung] = useState<ReadonlySet<string>>(new Set())
  const openPaths = useMemo(() => {
    if (searching) return folderPathsIn(shownTree)
    if (sprung.size === 0) return effectiveOpenPaths
    return new Set([...effectiveOpenPaths, ...sprung])
  }, [searching, shownTree, effectiveOpenPaths, sprung])
  const noMatches = searching && (shownTree.children ?? []).length === 0

  // Folders nest without limit, but a panel only fits so many levels of indent
  // before the names are squeezed out. Past that the tree drills in: it is
  // drawn from a deeper folder and the levels above fold into one `..` row
  // (lib/notes/shared/treeFocus.ts). How deep fits is read off the panel's
  // width. A search shows the whole tree it matched, so it is never focused.
  const [panelWidth, setPanelWidth] = useState(0)
  const [focus, setFocus] = useState<string | null>(null)
  // With no root row the root's children are the top rows, one level up.
  const maxDepth = maxRowDepthFor(panelWidth) + (root ? 0 : 1)
  const focusChain = useMemo(
    () => (focus && !searching ? drawnChain(shownTree, focus) : null),
    [focus, searching, shownTree],
  )
  const focusNode = focusChain ? folderNodeIn(focusChain[focusChain.length - 1], focus!) : null
  const focusRef = useRef<string | null>(null)
  focusRef.current = focusNode ? focus : null
  const panelWide = panelWidth > 0
  // Opening a folder whose rows would land past the edge drills in to them.
  const focusOn = useCallback(
    (folder: string) => {
      if (!panelWide) return
      const chain = drawnChain(shownTree, folder)
      const node = chain && folderNodeIn(chain[chain.length - 1] ?? shownTree, folder)
      if (chain && node) setFocus(focusFor([...chain, node], focusRef.current, maxDepth))
    },
    [panelWide, shownTree, maxDepth],
  )
  const toggleFocused = useCallback(
    (path: string, isOpen: boolean) => {
      toggleFolder(path, isOpen)
      if (!isOpen) focusOn(path)
    },
    [toggleFolder, focusOn],
  )
  const openFocused = useCallback(
    (path: string) => {
      openFolder(path)
      focusOn(path)
    },
    [openFolder, focusOn],
  )
  // A note opened from outside the tree (a link, a search hit, a profile) is
  // drilled to when it is not in the focused branch or sits past the edge. Keyed
  // on the note alone, so stepping up with `..` is not undone by a re-render.
  const revealTarget = revealPath ?? selectedPath
  useEffect(() => {
    if (!revealTarget || searching || !panelWide) return
    const chain = drawnChain(shownTree, revealTarget)
    if (chain) setFocus(focusFor(chain, focusRef.current, maxDepth))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the note moving is the only trigger
  }, [revealTarget, searching, panelWide])

  // Keep the selected row in view when selection changes from outside the tree
  // (context search focus, profile navigation). An off-screen row is centred so it
  // lands mid-panel, not clinging to an edge; an already-visible row stays put,
  // so ordinary clicks never cause a jump. Retries a few frames because a
  // collapsed ancestor folder auto-opens in response to the same selection
  // change, so the row may only mount a render later.
  const scrollRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setPanelWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Moving is a drag, and it reads like a sortable list: the row lifts off the
  // tree and follows the pointer, the tree keeps a slot open where it would
  // drop (Tree), the rows around the slot slide to make room as it passes them
  // (useTreeFlip), and folders open under the pointer and shut behind it. Every
  // point resolves to a place between rows — before or after the row under it,
  // or inside the folder under it — and the engine asks `dropVerdict` whether
  // the item may go in that folder. Dropping in the folder it came from is a
  // reorder. The rules read the tree the server sent, not the tiered one drawn.
  // A searched tree shows some of each folder, so a place in it isn't a place
  // in the folder: a drag there still moves, and the row lands by name.
  const [landed, setLanded] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const movingEnabled = canEdit && !!onMoveNote && !!onMoveFolder
  const canOrder = !!onOrderFolder && !searching
  const rootLabel = root?.label ?? 'the top level'
  // A successful drop keeps the row drawn in its new folder until the reloaded
  // tree arrives with the real one there — otherwise it would blink back home
  // for the length of a fetch.
  const treeArrived = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    treeArrived.current?.()
    treeArrived.current = null
  }, [tree])
  const { dragging, slot, intoFolder, away, dropped, press, lift, probe } = useTreeDrag({
    scrollRef,
    // Another space's folder keeps its own order, arranged from inside it.
    verdict: (item, folder) =>
      dropVerdict(tree, item, folder, canOrder && !readOnlyHere(indexPathOf(folder), writableSpaces)),
    onSpring: (folder) => setSprung((prev) => new Set(prev).add(folder)),
    // Shut what the drag opened and the pointer has left: a sprung folder stays
    // open only while the pointer is on it or on something inside it.
    onHover: (folder) =>
      setSprung((prev) => {
        const keep = [...prev].filter((p) => folder !== null && (folder === p || folder.startsWith(`${p}/`)))
        return keep.length === prev.size ? prev : new Set(keep)
      }),
    onEnd: () => setSprung((prev) => (prev.size === 0 ? prev : new Set())),
    onDrop: async (item, folder, index) => {
      const labels = { item: item.label, dest: (folder && folderLabelIn(tree, folder)) || rootLabel }
      // The place it was dropped at is stored with the move, before the tree
      // reloads, so the row never shows anywhere but where it was put.
      const order = canOrder && index !== null ? orderWith(tree, folder, item.path, index) : undefined
      const outcome =
        order && drawnParentOf(tree, item.path) === folder
          ? await onOrderFolder!(folder, order(item.path), item.path)
          : item.kind === 'placed'
            ? await onPlaceFolder?.(item.path, folder, order)
            : item.kind === 'folder'
              ? await onMoveFolder!(item.path, folder, labels, order)
              : await onMoveNote!(item.path, folder, labels, order)
      if (outcome?.status === 'failed') setNotice(outcome.message)
      if (outcome?.status !== 'moved') return
      if (folder) openFolder(folder)
      setLanded(outcome.path)
      await new Promise<void>((resolve) => {
        treeArrived.current = resolve
        window.setTimeout(resolve, 2000)
      })
    },
  })
  const drag = useMemo<TreeDragValue | null>(
    () => (movingEnabled ? { dragging, slot, intoFolder, away, dropped, canPlace: !!onPlaceFolder, press } : null),
    [movingEnabled, dragging, slot, intoFolder, away, dropped, onPlaceFolder, press],
  )

  const layout = useMemo(() => ({}), [dragging, slot, away, dropped, openPaths, tree]) // eslint-disable-line react-hooks/exhaustive-deps -- identity IS the signal
  useTreeFlip(scrollRef, probe, dragging !== null, layout, openPaths)

  // The row that just landed glows where it now sits, and is brought into view
  // if the move put it off screen. It mounts a reload after the drop, so the
  // scroll retries for a moment, like the selection's below.
  useEffect(() => {
    if (!landed) return
    let raf = 0
    let attempts = 0
    const reveal = () => {
      const container = scrollRef.current
      const el = container?.querySelector(`[data-tree-item="${CSS.escape(landed)}"]`)
      if (container && el) {
        const c = container.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        if (r.top < c.top || r.bottom > c.bottom) {
          const top = container.scrollTop + (r.top - c.top) - (c.height - r.height) / 2
          container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        }
      } else if (attempts++ < 40) {
        raf = requestAnimationFrame(reveal)
      }
    }
    reveal()
    const clear = window.setTimeout(() => setLanded(null), 2200)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(clear)
    }
  }, [landed])

  useEffect(() => {
    if (!notice) return
    const clear = window.setTimeout(() => setNotice(null), 7000)
    return () => window.clearTimeout(clear)
  }, [notice])

  // Restore before the reveal effect below runs, so an already-visible selected
  // row is found in place and no scroll animation plays at all.
  useEffect(() => {
    const el = scrollRef.current
    const saved = scrollMemory.get(storageKey ?? '')
    if (el && saved) el.scrollTop = saved
  }, [storageKey])

  const rememberScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      scrollMemory.set(storageKey ?? '', e.currentTarget.scrollTop)
    },
    [storageKey],
  )

  useEffect(() => {
    if (!selectedPath) return
    let raf = 0
    let attempts = 0
    const tryScroll = () => {
      const container = scrollRef.current
      const el = container?.querySelector(`[data-note-path="${CSS.escape(selectedPath)}"]`)
      if (container && el) {
        const c = container.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        if (r.top < c.top || r.bottom > c.bottom) {
          // The tree's own scrollport, and nothing above it. scrollIntoView
          // walks EVERY scrollable ancestor, so centring a row deep in a long
          // tree also scrolled <main> — which slid the note's title up behind
          // the floating toolbar the moment a note was opened.
          const top =
            container.scrollTop + (r.top - c.top) - (c.height - r.height) / 2
          container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        }
      } else if (attempts++ < 5) {
        raf = requestAnimationFrame(tryScroll)
      }
    }
    tryScroll()
    return () => cancelAnimationFrame(raf)
  }, [selectedPath])

  return (
    <TreeDrag.Provider value={drag}>
    <TreeLanded.Provider value={landed}>
    <TreeEnterSpace.Provider value={onEnterSpace ?? null}>
    <TreeWritableSpaces.Provider value={writableSpaces}>
    <div
      className={`relative flex h-full flex-col overflow-hidden ${
        /* bare = docked into the Sidebar column, which draws its own seam;
           floating = the tree beside a note, divided from it by one hairline */
        bare ? '' : 'border-r border-border-subtle'
      }`}
    >
      {/* overscroll-contain: hitting either end of the tree must not chain the
          wheel out to the page behind it (on the Context views that reads as the
          graph jumping while you scroll the tree). */}
      {/* overflow-x-hidden clips ROW_BLEED's overhang (overflow-y-auto alone
          would resolve x to auto and show a horizontal scrollbar). No px here:
          the row bands must reach both panel edges â€” rows carry their own
          inner padding. */}
      {/* The scrollport is itself a drop zone: the blank below the last row
          files to the top level, so there is no dead space to miss into. */}
      <div
        ref={scrollRef}
        onScroll={rememberScroll}
        data-drop-folder=""
        style={{ overflowAnchor: 'none' }}
        className="scrollbar-on-hover flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-3"
      >
        {/* pl only â€” it insets the row CONTENT off the panel edge while the
            bands still bleed past it; a matching pr would pull the bands'
            right edge in and break the full-width look. */}
        <div className="pl-2">
          {focusNode && focusChain ? (
            <>
              <FocusUpRow
                trail={focusChain.map((n, i) => (i === 0 ? (root?.label ?? null) : n.title ?? n.name)).filter((l): l is string => !!l)}
                onUp={() => setFocus(focusUp(focusChain))}
              />
              <FolderRow
                node={focusNode}
                openPaths={openPaths}
                onToggleFolder={toggleFocused}
                onOpenFolder={openFocused}
                selectedPath={selectedPath}
                canEdit={canEdit}
                onSelect={onSelect}
                onDeleteNote={onDeleteNote}
                folderBadges={folderBadges}
                onFolderAccess={onFolderAccess}
                onShareNote={onShareNote}
                onDeleteFolder={onDeleteFolder}
              />
            </>
          ) : root ? (
            // The context root as the tree's own top-level folder â€” same row
            // chrome as any other folder, so nesting reads uniformly from the
            // space down.
            <FolderRow
              node={shownTree}
              label={root.label}
              icon={root.icon ?? null}
              spaceRow
              openPaths={openPaths}
              onToggleFolder={toggleFocused}
              onOpenFolder={openFocused}
              selectedPath={selectedPath}
              canEdit={canEdit}
              onSelect={onSelect}
              onDeleteNote={onDeleteNote}
              folderBadges={folderBadges}
              onFolderAccess={onFolderAccess}
              onShareNote={onShareNote}
              onDeleteFolder={onDeleteFolder}
            />
          ) : (
            <Tree
              node={shownTree}
              openPaths={openPaths}
              onToggleFolder={toggleFocused}
              onOpenFolder={openFocused}
              selectedPath={selectedPath}
              canEdit={canEdit}
              onSelect={onSelect}
              onDeleteNote={onDeleteNote}
              folderBadges={folderBadges}
              onFolderAccess={onFolderAccess}
              onShareNote={onShareNote}
              onDeleteFolder={onDeleteFolder}
            />
          )}

          {noMatches && (
            <p className="px-3 py-4 text-sm text-text-muted">No notes match “{query.trim()}”.</p>
          )}

          {/* Trash sits at the very bottom of every context, below the whole tree
              â€” a folder-shaped row rather than a modal, so restoring reads as
              moving a note back rather than a separate admin surface. */}
          {trash && !searching && (
            <TrashFolder
              entries={trash}
              open={effectiveOpenPaths.has(TRASH_PATH)}
              onToggle={() => toggleFolder(TRASH_PATH, effectiveOpenPaths.has(TRASH_PATH))}
              onRestore={onRestoreTrash}
              onPurge={onPurgeTrash}
              onEmpty={onEmptyTrash}
              onOpen={onOpenTrash}
            />
          )}
        </div>
      </div>
      {/* Why a drop didn't take — the structural rule or the server's own
          words — said in the column it happened in, not in a browser alert. */}
      {notice && (
        <button
          type="button"
          onClick={() => setNotice(null)}
          className="dropdown-pop absolute inset-x-3 bottom-3 z-10 rounded-xl border border-border-subtle border-l-2 border-l-red-500 bg-surface-1 px-3 py-2 text-left text-sm leading-snug text-text-secondary shadow-float"
        >
          <span className="font-medium text-text-primary">Couldn’t move it. </span>
          {notice}
        </button>
      )}
    </div>
    {lift}
    </TreeWritableSpaces.Provider>
    </TreeEnterSpace.Provider>
    </TreeLanded.Provider>
    </TreeDrag.Provider>
  )
}

// â”€â”€ Trash â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Whole days left before the server purges an entry (0 = purges within the day). */
function daysLeft(deletedAt: number): number {
  const ms = deletedAt + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000 - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

function TrashFolder({
  entries,
  open,
  onToggle,
  onRestore,
  onPurge,
  onEmpty,
  onOpen,
}: {
  entries: TrashEntry[]
  open: boolean
  onToggle: () => void
  onRestore?: (id: string) => void
  onPurge?: (id: string) => void
  onEmpty?: () => void
  onOpen?: (entry: TrashEntry) => void
}) {
  return (
    <div className="mt-1" data-drop-none>
      <div data-flip-key=":trash:" className={`group/trash flex items-center pr-1.5 transition hover:bg-surface-2 ${ROW_BLEED}`}>
        <button
          type="button"
          aria-label={open ? 'Collapse trash' : 'Expand trash'}
          aria-expanded={open}
          onClick={onToggle}
          className="relative flex shrink-0 items-center self-stretch pl-1.5 pr-1.5 text-text-muted hover:text-text-primary"
        >
          {open && (
            <TreeStem />
          )}
          <TrashIcon />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[15px] text-text-secondary"
        >
          <span className="truncate font-medium">Trash</span>
          {entries.length > 0 && (
            <span className="shrink-0 text-[11px] font-semibold text-text-muted">{entries.length}</span>
          )}
        </button>
        <RowMenu
          selected={false}
          hoverClass="group-hover/trash:opacity-100"
          items={
            onEmpty && entries.length > 0
              ? [{ label: 'Empty trash', icon: <TrashIcon />, danger: true, onClick: onEmpty }]
              : []
          }
        />
      </div>
      <Branch open={open}>
        <div className={CHILD_INDENT}>
          {entries.length === 0 ? (
            <div className="py-1.5 pl-3 text-[13px] text-text-muted">Trash is empty.</div>
          ) : (
            entries.map((entry, i) => (
              <TrashRow
                key={entry.id}
                entry={entry}
                guide={i === entries.length - 1 ? 'last' : 'mid'}
                onRestore={onRestore}
                onPurge={onPurge}
                onOpen={onOpen}
              />
            ))
          )}
          {entries.length > 0 && (
            <div className="py-1 pl-3 text-[11px] text-text-muted">
              Deleted notes are removed for good after {TRASH_RETENTION_DAYS} days.
            </div>
          )}
        </div>
      </Branch>
    </div>
  )
}

function TrashRow({
  entry,
  guide,
  onRestore,
  onPurge,
  onOpen,
}: {
  entry: TrashEntry
  guide: Guide
  onRestore?: (id: string) => void
  onPurge?: (id: string) => void
  onOpen?: (entry: TrashEntry) => void
}) {
  const left = daysLeft(entry.deletedAt)
  // The row opens a READ-ONLY preview rather than the note itself: the note is
  // soft-deleted, so there is no live path to route to, but its content is all
  // still there, and "what was in it?" is the question you have to answer
  // before you can choose between Restore and Delete forever.
  const label = (
    <>
      <span className="shrink-0 text-text-muted">
        <FileIcon />
      </span>
      <span className="truncate text-text-secondary">{entry.title || entry.name}</span>
      <span className="shrink-0 text-[11px] text-text-muted">
        {left === 0 ? 'today' : `${left}d`}
      </span>
    </>
  )
  return (
    <div className={`group flex items-center pr-1.5 transition hover:bg-surface-2 ${ROW_BLEED}`}>
      <GuideLine guide={guide} />
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(entry)}
          title={entry.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left text-[15px]"
        >
          {label}
        </button>
      ) : (
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-[15px]"
          title={entry.path}
        >
          {label}
        </div>
      )}
      <RowMenu
        selected={false}
        items={[
          ...(onOpen ? [{ label: 'Preview', icon: <FileIcon />, onClick: () => onOpen(entry) }] : []),
          ...(onRestore ? [{ label: 'Restore', icon: <RestoreIcon />, onClick: () => onRestore(entry.id) }] : []),
          ...(onPurge
            ? [{ label: 'Delete forever', icon: <TrashIcon />, danger: true, onClick: () => onPurge(entry.id) }]
            : []),
        ]}
      />
    </div>
  )
}

function Tree({
  node,
  openPaths,
  onToggleFolder,
  onOpenFolder,
  selectedPath,
  canEdit,
  onSelect,
  onDeleteNote,
  folderBadges,
  onFolderAccess,
  onShareNote,
  onDeleteFolder,
}: {
  node: TreeNode
  openPaths: Set<string>
  onToggleFolder: (path: string, isOpen: boolean) => void
  onOpenFolder: (path: string) => void
  selectedPath: string | null
  canEdit: boolean
  onSelect: (path: string) => void
  onDeleteNote: (path: string) => void
  folderBadges?: Map<string, FolderBadge>
  onFolderAccess?: (folderId: string) => void
  onShareNote?: (path: string) => void
  onDeleteFolder?: (folderPath: string, label?: string) => void
}) {
  const drag = useContext(TreeDrag)
  // A folder's own index.md never renders as a child row â€” the folder row IS
  // the index (clicking the folder name opens it; see FolderRow). The context
  // root included: its index.md folds into the root folder row, so the
  // space reads as the parent folder of everything below it.
  const ownIndex = node.path && node.drawn !== 'main' ? `${node.path}/index.md` : 'index.md'
  // The held row is in hand, not in the tree: what the tree shows of it is the
  // slot it would drop into (below).
  const away = drag?.dragging && drag.away ? drag.dragging.path : null
  const children = (node.children ?? []).filter(
    (c) => !(c.kind === 'note' && c.path === ownIndex) && c.path !== away,
  )
  // An open folder with nothing in it draws a stem into blank space, which
  // reads as a branch that failed to load. One elbow into the word "Empty"
  // ends the line where the folder does.
  // The slot: while a row is held over a place in THIS folder, that place is
  // kept open for it — an empty row between the two it would sit between, which
  // moves as the pointer does. Every row says which place it is
  // (`data-slot-*`), and that is how the engine turns the point under the
  // pointer into one. `Main` is the context root's rows, so a place at the top
  // is a place there, not on the root that merely holds the tiers — whose rows
  // (Main, the rooms) have no places between them at all. Another space's
  // context is its own tier below this one's, so the last place is above it.
  const folderPath = node.drawn === 'main' ? '' : node.path
  const tiered = !node.path && (node.children ?? []).some((c) => c.drawn === 'main')
  const held = drag?.dragging && drag.slot?.folder === folderPath && !tiered ? drag.dragging : null
  const firstFederated = children.findIndex((c) => c.federated)
  const lastPlace = firstFederated === -1 ? children.length : firstFederated
  const previewAt = held ? Math.min(drag!.slot!.index, lastPlace) : -1
  const settled = !!drag?.dropped
  if (children.length === 0) return held ? <DropPreviewRow item={held} guide="last" settled={settled} /> : <EmptyBranchRow />
  const last = children.length - 1
  return (
    <>
      {children.map((child, i) => {
        // Where the space's own context ends and another space's begins. The
        // federated roots sort last (context.ts#sortTree), so one hairline
        // before the first of them is the whole tier boundary — without it a
        // room reads as one more folder of this space's.
        const seam = !!child.federated && !children[i - 1]?.federated
        const row = child.kind === 'folder' ? (
          <FolderRow
            key={child.path}
            node={child}
            place={tiered || child.federated ? undefined : { folder: folderPath, index: i }}
            guide={i === last && previewAt <= last ? 'last' : 'mid'}
            guideActive={onSelectedPath(child.path, selectedPath)}
            openPaths={openPaths}
            onToggleFolder={onToggleFolder}
            onOpenFolder={onOpenFolder}
            selectedPath={selectedPath}
            canEdit={canEdit}
            onSelect={onSelect}
            onDeleteNote={onDeleteNote}
            folderBadges={folderBadges}
            onFolderAccess={onFolderAccess}
            onShareNote={onShareNote}
            onDeleteFolder={onDeleteFolder}
          />
        ) : (
          <NoteRow
            key={child.path}
            title={child.title ?? child.name}
            path={child.path}
            declares={child.declares}
            place={tiered || child.federated ? undefined : { folder: folderPath, index: i }}
            guide={i === last && previewAt <= last ? 'last' : 'mid'}
            guideActive={selectedPath === child.path}
            selected={selectedPath === child.path}
            restrictedBadge={folderBadges?.get(child.path)?.restricted ?? false}
            canEdit={canEdit}
            onSelect={onSelect}
            onDelete={onDeleteNote}
            onShare={onShareNote}
          />
        )
        const preview = held && previewAt === i ? <DropPreviewRow item={held} guide="mid" settled={settled} /> : null
        if (!seam && !preview) return row
        return (
          <Fragment key={`${child.path}-tier`}>
            {preview}
            {seam && <TierSeam />}
            {row}
          </Fragment>
        )
      })}
      {held && previewAt > last && <DropPreviewRow item={held} guide="last" settled={settled} />}
    </>
  )
}

/** The hairline between this space's own context and the spaces read into it.
 *
 *  Built like a row rather than as a rule between rows: the guide column first,
 *  carrying its own piece of the vertical stroke, then the hairline filling the
 *  rest of the width. Drawn as a plain margin it broke the tree's vertical line
 *  in two and stopped short of the panel edge — the seam marks a tier, and a
 *  tier boundary crossing the branch it divides is exactly wrong. */
function TierSeam() {
  return (
    <div className="relative h-2" aria-hidden="true">
      {/* The branch's own stroke, continued through the seam: the guide column
          is where GuideLine puts it on every row above and below. */}
      <span className="tree-line absolute left-0 top-0 h-full w-px bg-border-default/70" />
      {/* Meets that stroke on the left and bleeds past the panel on the right
          (the scroll container clips it), so the hairline has no loose end. */}
      <span className="absolute inset-x-0 top-1/2 -mr-[999px] h-px bg-border-subtle" />
    </div>
  )
}

/** The levels the tree has drilled past, folded into one row: `..` and the
 *  folders it stands for. Pressing it steps back up one level. The trail keeps
 *  its END when it is cut — the folder just above is the one that matters. */
function FocusUpRow({ trail, onUp }: { trail: string[]; onUp: () => void }) {
  const path = trail.join(' / ')
  return (
    <div data-drop-none className={`flex items-center pr-1.5 transition hover:bg-surface-2 ${ROW_BLEED}`}>
      <button
        type="button"
        onClick={onUp}
        title={path}
        aria-label={`Up to ${trail[trail.length - 1] ?? 'the top'}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[15px] text-text-muted hover:text-text-primary"
      >
        <span className="flex shrink-0 items-center pl-1.5 pr-1.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 9 9 4 4 9" />
            <path d="M20 20h-7a4 4 0 0 1-4-4V4" />
          </svg>
        </span>
        <span className="shrink-0 font-semibold">..</span>
        {/* rtl moves the ellipsis to the START; the bdi keeps the words in order. */}
        <span dir="rtl" className="min-w-0 truncate text-[13px]">
          <bdi>{path}</bdi>
        </span>
      </button>
    </div>
  )
}

/** What an open folder shows when it holds nothing: the guide ends in an
 *  elbow against the word, rather than trailing down past the last row. */
function EmptyBranchRow() {
  return (
    <div className="flex items-center">
      <GuideLine guide="last" />
      <span className="py-1.5 pl-1.5 text-[13px] italic text-text-muted">Empty</span>
    </div>
  )
}

/** The slot: the place kept open for the held row, among the folder's
 *  children. While the row is in hand it is an EMPTY, unmarked gap the row's size — the
 *  row itself is the lift at the pointer — and once dropped it shows the row,
 *  until the reloaded tree arrives with the real one. It carries the held row's
 *  flip key, so it slides from place to place rather than jumping, and takes no
 *  pointer: the engine reads "the pointer is on the slot" as "stay". */
function DropPreviewRow({ item, guide, settled }: { item: MovableItem; guide: Guide; settled: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-drop-slot
      data-flip-key={item.path}
      className={`pointer-events-none flex items-center pr-1.5 ${ROW_BLEED}`}
    >
      <GuideLine guide={guide} />
      <span className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-[15px] ${settled ? '' : 'invisible'}`}>
        <span className="shrink-0 text-brand-green">
          {item.kind === 'note' ? <FileIcon /> : <FolderIcon />}
        </span>
        <span className="truncate font-medium text-text-primary">{item.label}</span>
      </span>
    </div>
  )
}

function FolderRow(props: {
  node: TreeNode
  /** Which place among its folder's rows this is (Tree) — absent on a row with
   *  no places beside it: the root, `Main`, a room, another space's context. */
  place?: TreeSlot
  /** Tree guide for a nested row. */
  guide?: Guide
  /** The open note is this folder or lives inside it â€” tints the guide. */
  guideActive?: boolean
  /** Overrides the folder's own name (used for the context-root row). */
  label?: string
  /** Overrides the folder glyph; explicit null renders no glyph (the root row). */
  icon?: React.ReactNode | null
  /** The space's own row: its name opens the space's Page. */
  spaceRow?: boolean
  openPaths: Set<string>
  onToggleFolder: (path: string, isOpen: boolean) => void
  onOpenFolder: (path: string) => void
  selectedPath: string | null
  canEdit: boolean
  onSelect: (path: string, opts?: { page?: boolean }) => void
  onDeleteNote: (path: string) => void
  folderBadges?: Map<string, FolderBadge>
  onFolderAccess?: (folderId: string) => void
  onShareNote?: (path: string) => void
  onDeleteFolder?: (folderPath: string, label?: string) => void
}) {
  // Expansion is owned by NoteSidebar (persisted, and revealed by selection) â€”
  // this row only reads it and reports toggles.
  const open = props.openPaths.has(props.node.path)
  const setOpen = () => props.onToggleFolder(props.node.path, open)
  // `Main` is drawn, not stored: it stands for the context root, so the space's
  // home note folds into its row the way it folded into the root's — and its
  // reserved path is never dragged, dropped on, shared or deleted.
  const drawnOnly = props.node.drawn === 'main'
  // Grants live at any depth now, so every folder row can carry a badge and a
  // Share affordance (keyed by the folder's full path).
  const badge = props.folderBadges?.get(props.node.path)
  const openPath = (path: string) => props.onSelect(path, props.spaceRow ? { page: true } : undefined)
  // Another space's context — a sub-space's, or what the parent shares — is
  // never SHARED from here: who sees it is that space's admins' act, made
  // there. It is moved and deleted here only by someone who stands in the
  // sub-space (TreeWritableSpaces); every other federated row is read-only
  // and carries no menu that would try.
  const federated = isFederatedPath(props.node.path)
  const readOnly = readOnlyHere(props.node.path, useContext(TreeWritableSpaces))
  const showAccess = !!props.onFolderAccess && !federated && !drawnOnly
  // Folder-note behaviour: when the folder has an index.md (hidden as a child
  // row by Tree), the folder row IS that note â€” clicking the name opens it and
  // selection highlights here. The chevron keeps expand/collapse to itself.
  // The context root works the same way over its own index.md, so the space
  // row opens the space's home note.
  // The folder's display name: an explicit label (the context root's), else the
  // title its index note declares, else the path segment.
  const folderLabel = props.label ?? props.node.title ?? props.node.name
  const indexPath = props.node.path && !drawnOnly ? `${props.node.path}/index.md` : 'index.md'
  const hasIndex = (props.node.children ?? []).some((c) => c.kind === 'note' && c.path === indexPath)
  const selected = hasIndex && props.selectedPath === indexPath
  // A directory entity is a folder from its first write, so most people and
  // organisations hold nothing but their own index. Showing each as an
  // expandable folder with nothing inside made the tree a wall of empty
  // chevrons — so an entity folder holding only its note reads as that note: the
  // entity's glyph, no expander, one click opens it. It is still a folder to
  // the drag machinery (a note dropped on Connor is filed under him), and it
  // grows back into a folder row the moment a sub-note lands.
  const entityIndex = hasIndex && isEntityFolderIndex(indexPath)
  const leaf = entityIndex && (props.node.children ?? []).every((c) => c.kind === 'note' && c.path === indexPath)

  // Moving: a folder row is a drag source (its whole subtree travels with it)
  // and a destination — and so is everything under it: a drop on any row files
  // into the folder that row belongs to, so the whole open folder is the
  // target and lights up as one block. The context root row is "top level"; it
  // is never a source.
  const drag = useContext(TreeDrag)
  // A room read into this tree: `space` names it and `parent` is unset (the
  // parent's shared folder carries both). Its row offers the door as well as
  // the folder — expanding it reads the room's context from here, opening it
  // stands you in the room.
  const enterSpace = useContext(TreeEnterSpace)
  const room = props.node.space && !props.node.parent ? props.node.space : null
  // A structural folder is PLACED, not moved: its path stays and the tree draws
  // it under the drop. The `Sub-spaces` folder and a room's folder are placed
  // in THIS space's tree (its index notes), so they drag even though their rows
  // are read here; a built-in folder inside a room is placed in the room, so
  // only someone who stands in it drags that one.
  const placeable = placeableOf(props.node.path)
  const item: MovableItem = { path: props.node.path, kind: placeable ? 'placed' : 'folder', label: folderLabel }
  const draggable =
    !!drag &&
    !!props.node.path &&
    !drawnOnly &&
    (placeable
      ? drag.canPlace && (placeable.space === null || !readOnly)
      : !readOnly && isMovable(props.node.path, 'folder'))
  const isDragged = drag?.dragging?.path === props.node.path
  // `Main` stands for the context root, so a drop on it files to the top.
  const dropPath = drawnOnly ? '' : props.node.path
  const isDropTarget = !!drag?.dragging && drag.intoFolder === dropPath && !drawnOnly
  const justLanded = useContext(TreeLanded) === props.node.path && !!props.node.path

  return (
    <div
      data-drop-folder={dropPath}
      className={`tree-drop-zone ${isDropTarget ? 'tree-drop-zone-on' : ''}`}
    >
      <div
        data-tree-item={props.node.path}
        data-flip-key={props.node.path || ':root:'}
        data-folder-row={dropPath}
        {...(open && !leaf ? { 'data-folder-open': '' } : {})}
        {...(props.place ? { 'data-slot-parent': props.place.folder, 'data-slot-index': props.place.index } : {})}
        // Resting on a shut folder mid-drag springs it open (useTreeDrag), so
        // a note can be dropped into a nested folder without letting go first.
        {...(!open && !leaf && !isDragged ? { 'data-spring-folder': props.node.path } : {})}
        onPointerDown={draggable ? (e) => drag!.press(item, e) : undefined}
        className={`group/folder flex items-center pr-1.5 transition ${ROW_BLEED} ${
          selected ? 'bg-brand-green/15' : 'hover:bg-surface-2'
        } ${isDragged ? 'tree-row-held' : ''} ${justLanded ? 'tree-row-land' : ''}`}
      >
        {props.guide && <GuideLine guide={props.guide} active={props.guideActive} />}
        {/* The folder glyph is the expand/collapse control â€” open vs shut is
            the icon itself, so the row needs no chevron beside the guide lines.
            self-stretch, not py-*: the row is as tall as the label button's
            15px line-box (~35px) while the icon's own content is 16px, so
            items-center leaves a ~3px dead strip above and below it where clicks
            land on the row div and nothing expands. Stretching makes the target
            the full row height. */}
        {leaf ? (
          <span
            className={`flex shrink-0 items-center self-stretch pl-1.5 pr-1.5 ${
              selected ? 'text-brand-green' : 'text-text-muted'
            }`}
          >
            <FileIcon />
          </span>
        ) : (
        <button
          type="button"
          aria-label={open ? 'Collapse folder' : 'Expand folder'}
          aria-expanded={open}
          onClick={() => setOpen()}
          className={`relative flex shrink-0 items-center self-stretch pl-1.5 pr-1.5 ${
            selected ? 'text-brand-green' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          {/* The stem: an open folder's children hang off a line that drops
              from this glyph rather than starting in mid-air below it. It
              begins just under the 16px glyph's bottom edge (half the row +
              8px + a hair of air) so it never draws through the icon, and sits
              at the glyph's centre â€” exactly where CHILD_INDENT puts the
              children's guides, so the two read as one line. */}
          {open && <TreeStem active={onSelectedPath(props.node.path, props.selectedPath)} />}
          {/* One mark for every folder, the root row included. */}
          {props.icon ?? <FolderIcon open={open} />}
        </button>
        )}
        <button
          type="button"
          onClick={() => {
            // A leaf entity has nothing to expand: the name IS the note.
            if (leaf) return openPath(indexPath)
            // Opening a folder's home note expands the folder too — and does it
            // HERE, on the click, rather than waiting for the reveal that the
            // new route feeds back down. That round trip is a navigation long,
            // and the folder sitting shut for it is what read as lag.
            if (!hasIndex) return setOpen()
            // Clicking the name of the folder whose note is ALREADY open is a
            // collapse: the note is on screen, so the only thing left to ask
            // for is to fold the branch away. Selection stays put.
            if (selected && open) return setOpen()
            // Otherwise pin it open rather than toggling: the row may already
            // LOOK open on a reveal it is about to lose — selecting the
            // folder's own note moves the reveal off whatever child chain was
            // holding it — and only a hand-opened entry survives that.
            props.onOpenFolder(props.node.path)
            openPath(indexPath)
          }}
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[15px] ${
            selected ? 'text-text-primary' : 'text-text-secondary'
          }`}
        >
          <span className={`truncate font-medium ${selected ? 'font-semibold' : ''}`}>
            {folderLabel}
          </span>
          {badge?.restricted && (
            <span className="shrink-0 text-text-muted" title="Restricted folder â€” access is granted here, not inherited">
              <LockIcon />
            </span>
          )}
          {badge?.level && (
            <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {badge.level}
            </span>
          )}
        </button>
        <RowMenu
          selected={selected}
          hoverClass="group-hover/folder:opacity-100"
          items={[
            ...(room && enterSpace
              ? [{ label: `Open ${folderLabel}`, icon: <Icon name="arrow-right" className="h-4 w-4" />, onClick: () => enterSpace(room) }]
              : []),
            ...(showAccess
              ? [{ label: 'Share', icon: <ShareIcon />, onClick: () => props.onFolderAccess!(props.node.path) }]
              : []),
            // No Delete on the root (that row is the context itself), nor on a
            // built-in folder: agents/, connectors/, tools/, people/ and the
            // rest are structure the runtime resolves against, so the row
            // offers no way to remove one (deleteFolderDenial).
            ...(props.onDeleteFolder && !readOnly && !drawnOnly && !deleteFolderDenial(props.node.path)
              ? [
                  {
                    label: 'Delete',
                    icon: <TrashIcon />,
                    danger: true,
                    onClick: () => props.onDeleteFolder!(props.node.path, folderLabel),
                  },
                ]
              : []),
          ]}
        />
      </div>
      {!leaf && <Branch open={open}>
        {/* Indented child container; each child row draws its own guide. The
            wrapper continues THIS row's own guide down past the subtree:
            without it the parent level's line breaks every time a folder is
            expanded, leaving a gap between the folder and its next sibling. */}
        <div className="relative">
          {props.guide === 'mid' && <TreeGuideRun active={props.guideActive} />}
          <div className={props.guide ? NESTED_CHILD_INDENT : CHILD_INDENT}>
            <Tree
              node={props.node}
              openPaths={props.openPaths}
              onToggleFolder={props.onToggleFolder}
              onOpenFolder={props.onOpenFolder}
              selectedPath={props.selectedPath}
              canEdit={props.canEdit}
              onSelect={props.onSelect}
              onDeleteNote={props.onDeleteNote}
              folderBadges={props.folderBadges}
              onFolderAccess={props.onFolderAccess}
              onShareNote={props.onShareNote}
              onDeleteFolder={props.onDeleteFolder}
            />
          </div>
        </div>
      </Branch>}
    </div>
  )
}

// â”€â”€ Row action menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface RowMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
}

const ROW_MENU_W = 160
const ROW_MENU_ITEM_H = 34

/** The â‹¯ button every row shows on hover, opening its actions (share, delete,
 *  shareâ€¦) in a small popup. The popup is a fixed-position portal: the tree's
 *  scroll container clips overflow on both axes, so an absolutely positioned
 *  menu inside the row would be cut off at the panel edge. Fixed positioning
 *  detaches from scrolling, so any scroll just closes the menu. */
function RowMenu({
  items,
  selected,
  hoverClass = 'group-hover:opacity-100',
}: {
  items: RowMenuItem[]
  selected: boolean
  /** The row's hover-group variant that reveals the trigger. */
  hoverClass?: string
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const close = useCallback(() => setPos(null), [])

  const toggle = () => {
    if (pos) return close()
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const height = items.length * ROW_MENU_ITEM_H + 10
    const openUp = r.bottom + height + 8 > window.innerHeight
    setPos({
      top: openUp ? r.top - height - 4 : r.bottom + 4,
      left: Math.max(8, r.right - ROW_MENU_W),
    })
  }

  useEffect(() => {
    if (!pos) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pos, close])

  if (items.length === 0) return null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-no-drag
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={toggle}
        className={`shrink-0 rounded p-1 transition ${
          selected ? 'text-text-secondary hover:text-text-primary' : 'text-text-muted hover:text-text-secondary'
        } ${pos ? 'opacity-100' : `opacity-0 ${hoverClass}`}`}
      >
        <KebabIcon />
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="dropdown-pop fixed z-[100] rounded-xl border border-border-subtle bg-surface-1 py-[5px] shadow-float"
            style={{ top: pos.top, left: pos.left, width: ROW_MENU_W }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  close()
                  item.onClick()
                }}
                className={`flex w-full items-center gap-2 px-3 text-left text-[13px] transition-colors hover:bg-surface-2 ${
                  item.danger ? 'text-red-500' : 'text-text-secondary'
                }`}
                style={{ height: ROW_MENU_ITEM_H }}
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

function NoteRow({
  title,
  path,
  declares,
  place,
  guide,
  guideActive,
  selected,
  restrictedBadge = false,
  canEdit,
  onSelect,
  onDelete,
  onShare,
}: {
  title: string
  path: string
  declares?: 'connector' | 'model'
  /** Which place among its folder's rows this is (Tree). */
  place?: TreeSlot
  /** Tree guide for a nested row. */
  guide?: Guide
  guideActive?: boolean
  selected: boolean
  /** The note is privately restricted â€” inherited access is cut at the note. */
  restrictedBadge?: boolean
  canEdit: boolean
  onSelect: (path: string) => void
  onDelete: (path: string) => void
  onShare?: (path: string) => void
}) {
  const drag = useContext(TreeDrag)
  // A sub-space's note is moved or deleted here only by someone who stands
  // in that sub-space; shared from here by nobody (see FolderRow).
  const readOnly = readOnlyHere(path, useContext(TreeWritableSpaces))
  const item: MovableItem = { path, kind: 'note', label: title, ...(declares ? { declares } : {}) }
  const draggable = !!drag && !readOnly && isMovable(path, 'note', declares)
  const isDragged = drag?.dragging?.path === path
  const justLanded = useContext(TreeLanded) === path
  return (
    <div
      data-note-path={path}
      data-tree-item={path}
      data-flip-key={path}
      {...(place ? { 'data-slot-parent': place.folder, 'data-slot-index': place.index } : {})}
      onPointerDown={draggable ? (e) => drag!.press(item, e) : undefined}
      className={`group flex items-center pr-1.5 transition ${ROW_BLEED} ${
        selected ? 'bg-brand-green/15' : 'hover:bg-surface-2'
      } ${isDragged ? 'tree-row-held' : ''} ${justLanded ? 'tree-row-land' : ''}`}
    >
      {guide && <GuideLine guide={guide} active={guideActive} />}
      <button
        type="button"
        onClick={() => onSelect(path)}
        className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[15px] ${
          // Notes carry no chevron, so the icon is padded across to sit under
          // the folder icons above it.
          guide ? 'pl-1.5' : 'pl-2'
        }`}
      >
        <span className={`shrink-0 ${selected ? 'text-brand-green' : 'text-text-muted'}`}>
          <FileIcon />
        </span>
        <span className={`truncate ${selected ? 'font-semibold text-text-primary' : 'text-text-primary'}`}>
          {title}
        </span>
        {restrictedBadge && (
          <span
            className={`shrink-0 ${selected ? 'text-brand-green' : 'text-text-muted'}`}
            title="Private note â€” access from its folders is cut off"
          >
            <LockIcon />
          </span>
        )}
      </button>
      <RowMenu
        selected={selected}
        items={[
          ...(onShare && !isFederatedPath(path)
            ? [{ label: 'Share', icon: <ShareIcon />, onClick: () => onShare(path) }]
            : []),
          ...(canEdit && !readOnly
            ? [{ label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => onDelete(path) }]
            : []),
        ]}
      />
    </div>
  )
}


// Horizontal â‹¯ â€” the rows' single actions trigger.
function KebabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

// Share glyph (same shape as the editor toolbar's lucide Share2).
function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
      <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </svg>
  )
}

// Counter-clockwise arrow (lucide RotateCcw) â€” the trash rows' Restore action.
function RestoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  )
}
