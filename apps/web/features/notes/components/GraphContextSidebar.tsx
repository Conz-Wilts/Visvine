'use client'

// The context tree docked into the global Sidebar while the /context page
// or a profile's Context tab is open — the same mechanism /channels and /admin
// use (ContextPanelContext's portal host), so the icon rail + tree read as one
// connected card rather than a panel floating over the canvas. It shows the
// community brain's full organised tree — index files, the people/ and
// companies/ namespaces, and every entity note. Clicking a note that maps to a
// directory entity opens that entity's profile Context tab;
// index/organisational notes just highlight. `currentPath` (the profile view)
// pre-highlights the open entity's note.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { useContextPanel } from '@/lib/contexts/ContextPanelContext'
import { isFeatureEnabled } from '@/lib/featureAccess'
import type { CommunityFeatureConfig } from '@/lib/types'
import type { NoteMeta, TreeNode } from '@/lib/notes/shared/types'
import type { ContextSourceMeta } from '@/lib/notes/shared/sourceTypes'
import { noteHref, parseEntityHref } from '@/lib/notes/entities'
import { notesApi } from '../lib/notesApi'
import { contextKeys, invalidateContextCache, swrFetch } from '../lib/contextPrefetch'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { NoteSidebar } from './NoteSidebar'

const EMPTY_TREE: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
// Below this the docked panel would crowd the graph — keep in sync with the
// Sidebar's DOCK_MIN_WIDTH so the rail and the request agree on when to dock.
const DOCK_MIN_WIDTH = 1024

export function GraphContextSidebar({
  currentPath = null,
  focusPath = null,
}: {
  currentPath?: string | null
  /** Note path to highlight + scroll to (the graph search's best match). Unlike
   *  a click it never navigates; null leaves the last selection in place. */
  focusPath?: string | null
}) {
  const router = useRouter()
  const { currentCommunity } = useCommunity()
  const { host, setDockRequested } = useContextPanel()
  const communityId = currentCommunity?.id ?? null
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null
  const notesEnabled = isFeatureEnabled(featureConfig, 'notes')

  const { entityByPath } = useDirectoryEntities()

  const [tree, setTree] = useState<TreeNode>(EMPTY_TREE)
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [starred, setStarred] = useState<string[]>([])
  const [sources, setSources] = useState<ContextSourceMeta[]>([])
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(currentPath)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    const active = wide && notesEnabled && !!communityId
    setDockRequested(active)
    return () => setDockRequested(false)
  }, [wide, notesEnabled, communityId, setDockRequested])

  // Load the tree + note index whenever the active community changes, through
  // the shared context cache: a cached value paints synchronously (re-opening
  // the Context tab shows the tree instantly, no spinner) and revalidates in
  // the background; the list fetch is deduped with EntityContextPanel's. A
  // gated or empty brain simply yields an empty tree (no error surfaced).
  useEffect(() => {
    if (!communityId || !notesEnabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      swrFetch(contextKeys.tree(communityId), () => notesApi.tree(communityId), ({ tree }) => {
        if (!cancelled) setTree(tree ?? EMPTY_TREE)
      }),
      swrFetch(contextKeys.list(communityId), () => notesApi.list(communityId), ({ notes, starred }) => {
        if (cancelled) return
        setNotes(notes ?? [])
        setStarred(starred ?? [])
      }),
    ])
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

  // Context sources list (small, uncached — uploads/deletes should show fresh).
  useEffect(() => {
    if (!communityId || !notesEnabled) return
    let cancelled = false
    notesApi
      .listSources(communityId)
      .then(({ sources }) => {
        if (!cancelled) setSources(sources)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [communityId, notesEnabled])

  const handleSelectSource = useCallback(
    (path: string) => {
      setSelectedPath(path)
      router.push(`/directory/source/${path.split('/').map(encodeURIComponent).join('/')}`)
    },
    [router],
  )

  const handleUploadSource = useCallback(
    (file: File) => {
      if (!communityId) return
      setSourceError(null)
      notesApi
        .uploadSource(communityId, file)
        .then(({ source }) => {
          setSources((prev) => [...prev.filter((s) => s.path !== source.path), source].sort((a, b) => a.path.localeCompare(b.path)))
        })
        .catch((e: unknown) => {
          setSourceError(e instanceof Error ? e.message : 'Upload failed')
        })
    },
    [communityId],
  )

  // Keep the highlight on the open entity's note as the profile view navigates
  // between entities (the sidebar itself survives via the layout portal).
  useEffect(() => {
    if (currentPath) setSelectedPath(currentPath)
  }, [currentPath])

  // Mirror the graph search's focused entity in the tree (highlight + scroll,
  // via NoteSidebar's scroll effect). Clearing the search keeps the last
  // selection, matching how the graph keeps its last camera.
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
      if (entity) router.push(`/directory/${encodeURIComponent(entity.id)}?tab=context`)
      else router.push(noteHref(path))
    },
    [entityByPath, router, currentPath],
  )

  const handleToggleStar = useCallback(
    (path: string, next: boolean) => {
      if (!communityId) return
      // Optimistic: reflect the toggle immediately, revert on failure.
      setStarred((prev) => (next ? [...prev, path] : prev.filter((p) => p !== path)))
      notesApi
        .star(communityId, path, next)
        .then(() => {
          // The cached list carries `starred` — drop it so the next open
          // doesn't repaint the pre-toggle state.
          invalidateContextCache(contextKeys.list(communityId))
        })
        .catch(() => {
          setStarred((prev) => (next ? prev.filter((p) => p !== path) : [...prev, path]))
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
      ) : notes.length === 0 && sources.length === 0 ? (
        <div className="px-3 py-4 text-sm text-text-muted">No context notes yet.</div>
      ) : (
        <>
          {sourceError && (
            <div className="px-3 pt-2 text-xs text-red-500">{sourceError}</div>
          )}
          <NoteSidebar
            tree={tree}
            notes={notes}
            starred={starred}
            selectedPath={selectedPath}
            canEdit={false}
            onSelect={handleSelect}
            onToggleStar={handleToggleStar}
            onDeleteNote={() => {}}
            bare
            sources={sources}
            onSelectSource={handleSelectSource}
            onUploadSource={handleUploadSource}
          />
        </>
      )}
    </div>,
    host,
  )
}
