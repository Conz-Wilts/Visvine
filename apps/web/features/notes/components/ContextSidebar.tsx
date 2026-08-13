'use client'

// The context tree docked into the global Sidebar while a note, a source or a
// profile's Context tab is open — the same mechanism /channels and /admin use
// (ContextPanelContext's portal host), so the icon rail + tree read as one
// connected card rather than a panel floating over the page. It shows the
// space brain's full organised tree — index files, the people/ and
// communities/ namespaces, and every entity note. Clicking a note that maps to
// a directory entity opens that entity's profile Context tab;
// index/organisational notes just highlight. `currentPath` (the profile view)
// pre-highlights the open entity's note.
//
// The tree's data and every mutation live in useContextTree — shared with the
// /context browser's rail. This component is the docking half only.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext'
import { isFeatureEnabled } from '@/lib/featureAccess'
import type { SpaceFeatureConfig } from '@/lib/types'
import { noteHref, parseEntityHref } from '@/lib/notes/entities'
import { prefetchNoteContext } from '../lib/contextPrefetch'
import { useContextTree } from '../lib/useContextTree'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { NoteSidebar } from './NoteSidebar'
import { SharePanel } from './SharePanel'

// Below this the docked panel would crowd the page — keep in sync with the
// Sidebar's DOCK_MIN_WIDTH so the rail and the request agree on when to dock.
const DOCK_MIN_WIDTH = 1024

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
  const { host, setDockRequested } = useContextPanel()
  const spaceId = currentSpace?.id ?? null
  const featureConfig = (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null
  const notesEnabled = isFeatureEnabled(featureConfig, 'notes')

  const { entityByPath } = useDirectoryEntities()
  const ctx = useContextTree({ spaceId, enabled: notesEnabled, currentPath })
  const { notes, trash, loading, error, shareTarget, setShareTarget } = ctx

  const [selectedPath, setSelectedPath] = useState<string | null>(currentPath)
  const [wide, setWide] = useState(false)

  // Only mark the tree dockable on wide viewports (matches the Sidebar), and only
  // while the notes tool is on. The panel column itself stays closed until the
  // user opens it (contextOpen, toggled from the note toolbar); lowering the flag
  // on unmount collapses it and hides the toggle.
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`)
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const active = wide && notesEnabled && !!spaceId
    setDockRequested(active)
    return () => setDockRequested(false)
  }, [wide, notesEnabled, spaceId, setDockRequested])

  // Keep the highlight on the open entity's note as the profile view navigates
  // between entities (the sidebar itself survives via the layout portal).
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
      const href = parseEntityHref(path)
      const entity = entityByPath.get(path) ?? (href ? entityByPath.get(href) : undefined)
      // Start the destination's data (and its JS chunk) NOW, in parallel with the
      // route change — both surfaces read the same note path through the same
      // cache, so by the time the panel mounts swrFetch paints it on the first
      // frame instead of holding a skeleton.
      if (spaceId) {
        prefetchNoteContext(spaceId, path)
        if (entity) void import('./EntityContextPanel').catch(() => {})
        else void import('./NoteContextPanel').catch(() => {})
      }
      if (entity) router.push(`/directory/${encodeURIComponent(entity.id)}?tab=context`)
      else router.push(noteHref(path))
    },
    [entityByPath, router, currentPath, spaceId],
  )

  // Nothing to render until the Sidebar's portal host is mounted and we're docking.
  if (!host || !wide || !notesEnabled || !spaceId) return null

  return createPortal(
    // No entrance animation here: this component re-mounts on every navigation
    // between docked surfaces, so a fade would replay each time and read as a
    // flash. The Sidebar's column owns the open/close motion instead — when it's
    // already open the tree swaps in place, pixel-identical (the cache repaints
    // it synchronously), which is what makes the transition invisible.
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-1">
      <div className="flex min-h-0 flex-1 flex-col">
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
              starred={ctx.starred}
              selectedPath={selectedPath}
              canEdit
              onSelect={handleSelect}
              onToggleStar={ctx.handleToggleStar}
              onDeleteNote={ctx.handleDeleteNote}
              bare
              root={ctx.rootFolder}
              storageKey={spaceId}
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
    </div>,
    host,
  )
}
