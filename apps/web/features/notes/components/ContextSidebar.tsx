'use client'

// The context tree beside a note, a source or a profile's Context tab: a
// sticky column inside the pane, part of the content surface rather than a
// panel docked into the Sidebar. It shows the space context's full organised
// tree — index files, the people/ and communities/ namespaces, and every
// entity note. Clicking a note that maps to a directory entity opens that
// entity's profile Context tab; index/organisational notes just highlight.
// `currentPath` (the profile view) pre-highlights the open entity's note.
//
// The tree's data and every mutation live in useContextTree — shared with the
// /context browser's rail. This component is the column only.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { usePaneChromeState } from '@/features/shared/contexts/PaneShellContext'
import { TRAY_ROW_H } from '@/features/shared/components/pane/PaneTabBar'
import { isFeatureEnabled } from '@/lib/featureAccess'
import type { SpaceFeatureConfig } from '@/lib/types'
import { entityContextHref, noteHref, resolveEntityOwner, trashHref } from '@/lib/notes/entities'
import { prefetchNoteContext } from '../lib/contextPrefetch'
import { useContextTree } from '../lib/useContextTree'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import SearchInput from '@/components/ui/SearchInput'
import { NoteSidebar } from './NoteSidebar'
import { SharePanel } from './SharePanel'
import { SHELL_PANE_TOP, SHELL_TOP_BAR_H } from '@/features/shared/contexts/ThemeContext'

/** Width of the tree column. The pane tab bars inset their toolbar tray by the
 *  same amount so the tray centres over the note, not the whole pane. */
export const CONTEXT_PANEL_W = 300
/** <main>'s bottom padding (pb-6 in AuthLayoutClient). The column stops short
 *  of it: a column that ran to the viewport's bottom edge would make <main>
 *  overflow by exactly that padding, and those few pixels of scroll have no
 *  sticky range to absorb them — the whole column would ride up under the tab
 *  row on notes short enough that the column is the tallest thing in the row. */
const MAIN_PAD_B = 24
/** Below this the column is hidden (Tailwind lg); anything that lines up with
 *  it — the tab bar's toolbar tray — reads the same breakpoint through here. */
const TREE_MIN_W = 1024

/** True when the tree column is actually taking width: wide enough to render.
 *  The column has no switch — where it fits, it is open. Anything that lines
 *  up with the column (the tab bar's toolbar tray) reads this rather than the
 *  breakpoint directly. */
export function useContextTreeVisible(): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${TREE_MIN_W}px)`)
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return wide
}

export function ContextSidebar({
  currentPath = null,
  focusPath = null,
}: {
  currentPath?: string | null
  /** Note path to highlight + scroll to. Unlike a click it never navigates;
   *  null leaves the last selection in place. */
  focusPath?: string | null
}) {
  const router = useRouter()
  const { currentSpace } = useSpace()
  // The toolbar tray only centres over the note column, so the tree climbs
  // past it to sit flush under the tab row whenever it's open.
  const trayOpen = !!usePaneChromeState().chrome?.attachedOpen
  const spaceId = currentSpace?.id ?? null
  const featureConfig = (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null
  const notesEnabled = isFeatureEnabled(featureConfig, 'notes')

  const { entityByPath } = useDirectoryEntities()
  const ctx = useContextTree({ spaceId, enabled: notesEnabled, currentPath })
  const { notes, trash, loading, error, shareTarget, setShareTarget } = ctx

  const [selectedPath, setSelectedPath] = useState<string | null>(currentPath)
  // The Directory's search, on the Context tab: the tree is this tab's browse
  // surface the way the cards are the Grid's, so the box filters it.
  const [query, setQuery] = useState('')

  // Keep the highlight on the open entity's note as the profile view navigates
  // between entities (the column itself survives in the pane shell).
  useEffect(() => {
    if (currentPath) setSelectedPath(currentPath)
  }, [currentPath])

  useEffect(() => {
    if (focusPath) setSelectedPath(focusPath)
  }, [focusPath])

  // Entity notes open their profile Context tab; everything else (folder
  // indexes, sectors, deals…) opens the standalone note view.
  const handleSelect = useCallback(
    (path: string) => {
      setSelectedPath(path)
      if (path === currentPath) return
      // An entity note (either form) or a sub-note in an entity folder opens
      // under the entity's chrome; everything else is a plain note.
      const owner = resolveEntityOwner(path, entityByPath)
      // Start the destination's data (and its JS chunk) NOW, in parallel with the
      // route change — both surfaces read the same note path through the same
      // cache, so by the time the panel mounts swrFetch paints it on the first
      // frame instead of holding a skeleton.
      if (spaceId) {
        prefetchNoteContext(spaceId, path)
        if (owner) void import('./EntityContextPanel').catch(() => {})
        else void import('./NoteContextPanel').catch(() => {})
      }
      router.push(owner ? entityContextHref(owner.id, owner.subPath) : noteHref(path))
    },
    [entityByPath, router, currentPath, spaceId],
  )

  if (!notesEnabled || !spaceId) return null

  // Starts at the content line — <main>'s content-box top, where the note card
  // and the connections rail start — and runs to just above <main>'s bottom
  // padding, scrolling on its own while the note scrolls the page.
  //
  // `top: 0`, not SHELL_PANE_TOP: a sticky offset is measured from the
  // scrollport ALREADY inset by <main>'s padding, so SHELL_PANE_TOP there
  // counts that padding twice and asks the column to sit 24px lower than it
  // flows. On a long note the browser grants that shift; on a short one the
  // containing block has no room and the column stays where it flowed — which
  // is the whole bug: the tree landed 24px apart depending on how long the open
  // note happened to be. At 0 the sticky line IS the flow position, so there is
  // never a shift to grant or refuse.
  //
  // Hidden below lg, where the column would crowd the note. No entrance
  // animation: it re-mounts on every navigation between surfaces, and the cache
  // repaints the tree synchronously, so it swaps in place pixel-identical.
  return (
    <aside
      className="sticky hidden shrink-0 flex-col overflow-hidden lg:flex"
      style={{
        width: CONTEXT_PANEL_W,
        top: 0,
        height: `calc(100dvh - ${SHELL_TOP_BAR_H + SHELL_PANE_TOP + MAIN_PAD_B}px)`,
        marginTop: trayOpen ? -TRAY_ROW_H : 0,
        transition: 'margin-top 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col" style={{ width: CONTEXT_PANEL_W }}>
        {/* The tree's own filter, sized to the column: the `md` field, running
            the full width the tree rows run and starting on the same left edge
            they do. The Grid and Resources tabs carry the big `lg` field
            because search is the whole surface there; here it is one control
            at the head of a list, the way the Table's is one control on its
            bar. */}
        <div className="shrink-0 pb-2 pl-2 pr-2 pt-0.5">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search the context…"
            size="md"
            className="w-full"
          />
        </div>

        {loading && notes.length === 0 ? (
          <div className="px-3 py-4 text-sm text-text-muted">Loading context…</div>
        ) : error ? (
          <div className="px-3 py-4 text-sm text-red-500">{error}</div>
        ) : notes.length === 0 && trash.length === 0 ? (
          <div className="px-3 py-4 text-sm text-text-muted">No context notes yet.</div>
        ) : (
          <>
            <NoteSidebar
              tree={ctx.tree}
              notes={notes}
              selectedPath={selectedPath}
              canEdit
              onSelect={handleSelect}
              onDeleteNote={ctx.handleDeleteNote}
              bare
              root={ctx.rootFolder}
              storageKey={spaceId}
              query={query}
              // The search focus (and, on a profile, the open note) only PEEKS
              // the tree open — clearing the search restores the user's own
              // expand/collapse state. selectedPath keeps the highlight after
              // that, which is why the peek can't be derived from it.
              revealPath={focusPath ?? currentPath}
              folderBadges={ctx.folderBadges}
              onFolderAccess={
                spaceId.startsWith('me:')
                  ? undefined
                  : (path) => setShareTarget({ path, kind: 'folder' })
              }
              onShareNote={(path) => setShareTarget({ path, kind: 'note' })}
              onDeleteFolder={ctx.handleDeleteFolder}
              // Drag a note (or a whole folder) onto another folder to file it
              // there; the same move is in each row's menu as "Move to...".
              onMoveNote={ctx.handleMoveNote}
              onMoveFolder={ctx.handleMoveFolder}
              trash={trash}
              // A trashed note reads in the main content area, like any other
              // note — its own route, not a dialog over the tree.
              onOpenTrash={(entry) => router.push(trashHref(entry.id))}
              onRestoreTrash={ctx.handleRestoreTrash}
              onPurgeTrash={ctx.handlePurgeTrash}
              onEmptyTrash={ctx.handleEmptyTrash}
            />
            {shareTarget !== null && (
              <SharePanel
                spaceId={spaceId}
                path={shareTarget.path}
                kind={shareTarget.kind}
                onClose={() => setShareTarget(null)}
              />
            )}
          </>
        )}
      </div>
      {/* Every delete in the tree asks here — in the middle of the screen, in
          the app's own chrome, rather than in a browser confirm. */}
      <ConfirmDialog {...ctx.confirm} />
    </aside>
  )
}
