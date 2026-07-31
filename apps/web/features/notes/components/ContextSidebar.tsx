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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { useContextPanel } from '@/lib/contexts/ContextPanelContext'
import { isFeatureEnabled } from '@/lib/featureAccess'
import { DEFAULT_CONTEXT_NAME } from '@/lib/notes/shared/contextSettings'
import type { CommunityFeatureConfig } from '@/lib/types'
import type { NoteMeta, TreeNode } from '@/lib/notes/shared/types'
import { noteHref, parseEntityHref } from '@/lib/notes/entities'
import { notesApi, type AccessOverviewResponse } from '../lib/notesApi'
import { contextKeys, invalidateContextCache, prefetchNoteContext, swrFetch } from '../lib/contextPrefetch'
import { useDirectoryEntities } from '../lib/useDirectoryEntities'
import { NoteSidebar } from './NoteSidebar'
import { SharePanel } from './SharePanel'

const EMPTY_TREE: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
// Below this the docked panel would crowd the context — keep in sync with the
// Sidebar's DOCK_MIN_WIDTH so the rail and the request agree on when to dock.
const DOCK_MIN_WIDTH = 1024

export function ContextSidebar({
  currentPath = null,
  focusPath = null,
}: {
  currentPath?: string | null
  /** Note path to highlight + scroll to (the context search's best match). Unlike
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
  const [selectedPath, setSelectedPath] = useState<string | null>(currentPath)
  const [overview, setOverview] = useState<AccessOverviewResponse | null>(null)
  const [contextName, setContextName] = useState<string | null>(null)
  const [shareTarget, setShareTarget] = useState<{ path: string; kind: 'note' | 'folder' } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wide, setWide] = useState(false)
  // Bumped after a tree mutation (delete) to re-run the load effect.
  const [treeVersion, setTreeVersion] = useState(0)

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
  }, [communityId, notesEnabled, treeVersion])

  // The context's display name for the panel header (renameable from the
  // console). Failure just leaves the default label — never blocks the tree.
  useEffect(() => {
    setContextName(null)
    if (!communityId || !notesEnabled) return
    let cancelled = false
    swrFetch(
      contextKeys.settings(communityId),
      () => notesApi.getBrainSettings(communityId),
      ({ settings }) => {
        if (!cancelled) setContextName(settings?.contextName ?? null)
      },
    ).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [communityId, notesEnabled])

  // Access overview: restricted/locked boundaries (folders AND private notes)
  // for the 🔒 badges. Personal spaces have no boundaries — skip the fetch.
  // shareOpen is a dep so closing the Share panel repaints badges it changed.
  const shareOpen = shareTarget !== null
  useEffect(() => {
    if (!communityId || !notesEnabled || communityId.startsWith('me:')) {
      setOverview(null)
      return
    }
    let cancelled = false
    notesApi
      .getAccessOverview(communityId)
      .then((o) => {
        if (!cancelled) setOverview(o)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [communityId, notesEnabled, shareOpen])

  const folderBadges = useMemo(() => {
    if (!overview) return undefined
    const map = new Map<string, { restricted: boolean; locked?: boolean }>()
    for (const path of overview.restricted) map.set(path, { restricted: true })
    for (const path of overview.locked) {
      map.set(path, { ...(map.get(path) ?? { restricted: false }), locked: true })
    }
    return map.size ? map : undefined
  }, [overview])

  // The community as the tree's root folder — everything below it is literally
  // its children, so it renders as a folder row (chevron + name, no glyph)
  // rather than a separate header bar above the list. A renamed context wins
  // the label; the generic default defers to the community name.
  const rootFolder = useMemo(
    () => ({
      label:
        contextName && contextName !== DEFAULT_CONTEXT_NAME
          ? contextName
          : (currentCommunity?.name ?? 'Community'),
    }),
    [contextName, currentCommunity?.name],
  )

  // Keep the highlight on the open entity's note as the profile view navigates
  // between entities (the sidebar itself survives via the layout portal).
  useEffect(() => {
    if (currentPath) setSelectedPath(currentPath)
  }, [currentPath])

  // Mirror the context search's focused entity in the tree (highlight + scroll,
  // via NoteSidebar's scroll effect). Clearing the search keeps the last
  // selection, matching how the context keeps its last camera.
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
      if (communityId) {
        prefetchNoteContext(communityId, path)
        if (entity) void import('./EntityContextPanel').catch(() => {})
        else void import('./NoteContextPanel').catch(() => {})
      }
      if (entity) router.push(`/directory/${encodeURIComponent(entity.id)}?tab=context`)
      else router.push(noteHref(path))
    },
    [entityByPath, router, currentPath, communityId],
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

  // Delete = move to the brain's trash (restorable from the console). Authority
  // is enforced server-side per note — the menu can't know each viewer's level,
  // so a rejected delete just surfaces its message. Deleting the note that's
  // open navigates back to the context canvas.
  const handleDeleteNote = useCallback(
    (path: string) => {
      if (!communityId) return
      const title = notes.find((n) => n.path === path)?.title ?? path
      if (!window.confirm(`Delete “${title}”? It moves to the context trash and can be restored.`)) return
      notesApi
        .remove(communityId, path)
        .then(() => {
          invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
          setTreeVersion((v) => v + 1)
          if (path === currentPath) router.push('/directory?view=context')
        })
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to delete the note')
        })
    },
    [communityId, notes, currentPath, router],
  )

  // Deleting a folder trashes every note inside it, so the confirm spells that
  // out with the actual count. Same server-side authority + trash semantics as
  // a single note; navigates home if the open note lived inside the folder.
  const handleDeleteFolder = useCallback(
    (folderPath: string) => {
      if (!communityId) return
      const name = folderPath.split('/').pop() ?? folderPath
      const count = notes.filter((n) => n.path.startsWith(`${folderPath}/`)).length
      const contents =
        count === 0
          ? 'It is empty.'
          : `This will also delete the ${count === 1 ? 'note' : `${count} notes`} inside it (moved to the context trash, restorable).`
      if (!window.confirm(`Delete the folder “${name}”? ${contents}`)) return
      notesApi
        .deleteFolder(communityId, folderPath)
        .then(() => {
          invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
          setTreeVersion((v) => v + 1)
          if (currentPath?.startsWith(`${folderPath}/`)) router.push('/directory?view=context')
        })
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to delete the folder')
        })
    },
    [communityId, notes, currentPath, router],
  )

  // Nothing to render until the Sidebar's portal host is mounted and we're docking.
  if (!host || !wide || !notesEnabled || !communityId) return null

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
        ) : notes.length === 0 ? (
          <div className="px-3 py-4 text-sm text-text-muted">No context notes yet.</div>
        ) : (
          <>
            <NoteSidebar
              tree={tree}
              notes={notes}
              starred={starred}
              selectedPath={selectedPath}
              canEdit
              onSelect={handleSelect}
              onToggleStar={handleToggleStar}
              onDeleteNote={handleDeleteNote}
              bare
              root={rootFolder}
              storageKey={communityId}
              // The search focus (and, on a profile, the open note) only PEEKS
              // the tree open — clearing the search restores the user's own
              // expand/collapse state. selectedPath keeps the highlight after
              // that, which is why the peek can't be derived from it.
              revealPath={focusPath ?? currentPath}
              folderBadges={folderBadges}
              onFolderAccess={
                communityId.startsWith('me:')
                  ? undefined
                  : (path) => setShareTarget({ path, kind: 'folder' })
              }
              onShareNote={(path) => setShareTarget({ path, kind: 'note' })}
              onDeleteFolder={handleDeleteFolder}
            />
            {shareTarget !== null && (
              <SharePanel
                communityId={communityId}
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
