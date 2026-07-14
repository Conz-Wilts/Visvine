'use client'

// The context tree docked into the global Sidebar while the directory graph view
// is open — the same mechanism /channels and /admin use (ContextPanelContext's
// portal host), so the icon rail + tree read as one connected card rather than a
// panel floating over the canvas. It shows the community brain's full organised
// tree — index files, the people/ and companies/ namespaces, and every entity
// note. Clicking a note that maps to a directory entity opens that entity's
// profile Context tab; index/organisational notes just highlight.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { useContextPanel } from '@/lib/contexts/ContextPanelContext'
import { isFeatureEnabled } from '@/lib/featureAccess'
import type { CommunityFeatureConfig } from '@/lib/types'
import type { NoteMeta, TreeNode } from '@/lib/notes/shared/types'
import { parseEntityHref } from '@/lib/notes/entities'
import { notesApi } from '../lib/notesApi'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { NoteSidebar } from './NoteSidebar'

const EMPTY_TREE: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
// Below this the docked panel would crowd the graph — keep in sync with the
// Sidebar's DOCK_MIN_WIDTH so the rail and the request agree on when to dock.
const DOCK_MIN_WIDTH = 1024

export function GraphContextSidebar() {
  const router = useRouter()
  const { currentCommunity } = useCommunity()
  const { host, setDockRequested } = useContextPanel()
  const communityId = currentCommunity?.id ?? null
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null
  const notesEnabled = isFeatureEnabled(featureConfig, 'notes')

  const { entityByPath } = useDirectoryEntities()

  const [tree, setTree] = useState<TreeNode>(EMPTY_TREE)
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [pinned, setPinned] = useState<string[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wide, setWide] = useState(false)

  // Only request the dock on wide viewports (matches the Sidebar), and only while
  // the notes tool is on. Lowering the flag on unmount collapses the panel column.
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`)
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const active = wide && notesEnabled && !!communityId
    setDockRequested(active)
    return () => setDockRequested(false)
  }, [wide, notesEnabled, communityId, setDockRequested])

  // Load the tree + note index whenever the active community changes. A gated or
  // empty brain simply yields an empty tree (no error surfaced).
  useEffect(() => {
    if (!communityId || !notesEnabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([notesApi.tree(communityId), notesApi.list(communityId)])
      .then(([{ tree }, { notes, pinned }]) => {
        if (cancelled) return
        setTree(tree ?? EMPTY_TREE)
        setNotes(notes ?? [])
        setPinned(pinned ?? [])
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load context')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [communityId, notesEnabled])

  // Entity notes open their profile Context tab; everything else just highlights.
  const handleSelect = useCallback(
    (path: string) => {
      setSelectedPath(path)
      const href = parseEntityHref(path)
      const entity = entityByPath.get(path) ?? (href ? entityByPath.get(href) : undefined)
      if (entity) router.push(`/directory/${encodeURIComponent(entity.id)}?tab=context`)
    },
    [entityByPath, router],
  )

  const handleTogglePin = useCallback(
    (path: string, next: boolean) => {
      if (!communityId) return
      // Optimistic: reflect the toggle immediately, revert on failure.
      setPinned((prev) => (next ? [...prev, path] : prev.filter((p) => p !== path)))
      notesApi.pin(communityId, path, next).catch(() => {
        setPinned((prev) => (next ? prev.filter((p) => p !== path) : [...prev, path]))
      })
    },
    [communityId],
  )

  // Nothing to render until the Sidebar's portal host is mounted and we're docking.
  if (!host || !wide || !notesEnabled || !communityId) return null

  return createPortal(
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-1" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {loading && notes.length === 0 ? (
        <div className="px-3 py-4 text-sm text-text-muted">Loading context…</div>
      ) : error ? (
        <div className="px-3 py-4 text-sm text-red-500">{error}</div>
      ) : notes.length === 0 ? (
        <div className="px-3 py-4 text-sm text-text-muted">No context notes yet.</div>
      ) : (
        <NoteSidebar
          tree={tree}
          notes={notes}
          pinned={pinned}
          selectedPath={selectedPath}
          canEdit={false}
          onSelect={handleSelect}
          onTogglePin={handleTogglePin}
          onDeleteNote={() => {}}
          bare
        />
      )}
    </div>,
    host,
  )
}
