'use client'

// The community context tree, loaded once and owned in one place.
//
// Two surfaces render the same tree: the docked ContextSidebar (portalled into
// the global Sidebar from a note, a source or a profile) and the /context
// knowledge browser's left rail. They differ only in where they put it and what
// a click means — the loading, the trash, the access badges and every mutation
// are identical, so they live here rather than being copied into both.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCommunity } from '@/features/shared/contexts/CommunityContext'
import { DEFAULT_CONTEXT_NAME } from '@/lib/notes/shared/contextSettings'
import type { NoteMeta, TreeNode, TrashEntry } from '@/lib/notes/shared/types'
import { notesApi, type AccessOverviewResponse } from './notesApi'
import { contextKeys, invalidateContextCache, swrFetch } from './contextPrefetch'

const EMPTY_TREE: TreeNode = { name: '', path: '', kind: 'folder', children: [] }

/** Where a surface sends the user when the note it was showing is deleted. */
const CONTEXT_HOME = '/directory?view=context'

export interface ContextTreeOptions {
  communityId: string | null
  /** False while the notes tool is off — no fetching, empty tree. */
  enabled: boolean
  /** The note the host surface currently has open, if any. Deleting it navigates home. */
  currentPath?: string | null
}

export function useContextTree({ communityId, enabled, currentPath = null }: ContextTreeOptions) {
  const router = useRouter()
  const { currentCommunity } = useCommunity()

  const [tree, setTree] = useState<TreeNode>(EMPTY_TREE)
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [starred, setStarred] = useState<string[]>([])
  const [trash, setTrash] = useState<TrashEntry[]>([])
  const [overview, setOverview] = useState<AccessOverviewResponse | null>(null)
  const [contextName, setContextName] = useState<string | null>(null)
  const [shareTarget, setShareTarget] = useState<{ path: string; kind: 'note' | 'folder' } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped after a tree mutation (delete, restore, purge) to re-run the loads.
  const [treeVersion, setTreeVersion] = useState(0)

  const active = enabled && !!communityId

  // Load the tree + note index whenever the active community changes, through
  // the shared context cache: a cached value paints synchronously (re-opening
  // the Context tab shows the tree instantly, no spinner) and revalidates in
  // the background; the list fetch is deduped with EntityContextPanel's. A
  // gated or empty brain simply yields an empty tree (no error surfaced).
  useEffect(() => {
    if (!communityId || !active) return
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
  }, [communityId, active, treeVersion])

  // The brain's trash, for the folder pinned to the bottom of the tree. Re-runs
  // on treeVersion so a delete lands in the trash row immediately; the GET also
  // purges anything past its retention window, so the list is what the server
  // would keep. A failure just leaves the row empty.
  useEffect(() => {
    if (!communityId || !active) return
    let cancelled = false
    notesApi
      .trash(communityId)
      .then(({ trash }) => {
        if (!cancelled) setTrash(trash ?? [])
      })
      .catch(() => {
        if (!cancelled) setTrash([])
      })
    return () => {
      cancelled = true
    }
  }, [communityId, active, treeVersion])

  // The context's display name for the header (renameable from the console).
  // Failure just leaves the default label — never blocks the tree.
  useEffect(() => {
    setContextName(null)
    if (!communityId || !active) return
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
  }, [communityId, active])

  // Access overview: restricted/locked boundaries (folders AND private notes)
  // for the 🔒 badges. Personal spaces have no boundaries — skip the fetch.
  // shareOpen is a dep so closing the Share panel repaints badges it changed.
  const shareOpen = shareTarget !== null
  useEffect(() => {
    if (!communityId || !active || communityId.startsWith('me:')) {
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
  }, [communityId, active, shareOpen])

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
          : (currentCommunity?.name ?? 'Space'),
    }),
    [contextName, currentCommunity?.name],
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

  // Delete = move to the brain's trash (restorable from the tree's Trash folder
  // for 7 days, then purged). Authority is enforced server-side per note — the
  // menu can't know each viewer's level, so a rejected delete just surfaces its
  // message. Deleting the note that's open navigates back to the browser.
  const handleDeleteNote = useCallback(
    (path: string) => {
      if (!communityId) return
      const title = notes.find((n) => n.path === path)?.title ?? path
      if (!window.confirm(`Delete “${title}”? It moves to Trash and can be restored for 7 days.`)) return
      notesApi
        .remove(communityId, path)
        .then(() => {
          invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
          setTreeVersion((v) => v + 1)
          if (path === currentPath) router.push(CONTEXT_HOME)
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
    // `label` is the name the row showed — a folder's index-note title when it
    // has one. The confirm has to name the folder the user clicked, not the path
    // segment behind it.
    (folderPath: string, label?: string) => {
      if (!communityId) return
      const name = label?.trim() || folderPath.split('/').pop() || folderPath
      const count = notes.filter((n) => n.path.startsWith(`${folderPath}/`)).length
      const contents =
        count === 0
          ? 'It is empty.'
          : `This will also delete the ${count === 1 ? 'note' : `${count} notes`} inside it (moved to Trash, restorable for 7 days).`
      if (!window.confirm(`Delete the folder “${name}”? ${contents}`)) return
      notesApi
        .deleteFolder(communityId, folderPath)
        .then(() => {
          invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
          setTreeVersion((v) => v + 1)
          if (currentPath?.startsWith(`${folderPath}/`)) router.push(CONTEXT_HOME)
        })
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to delete the folder')
        })
    },
    [communityId, notes, currentPath, router],
  )

  // Restoring puts the note back at its original path (suffixed if something
  // else took it while it sat in the trash) — bumping treeVersion reloads the
  // tree, the note list and the trash together.
  const handleRestoreTrash = useCallback(
    (id: string) => {
      if (!communityId) return
      notesApi
        .restoreTrash(communityId, id)
        .then(() => {
          invalidateContextCache(contextKeys.tree(communityId), contextKeys.list(communityId))
          setTreeVersion((v) => v + 1)
        })
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to restore the note')
        })
    },
    [communityId],
  )

  // Force-delete, ahead of the 7-day retention. Irreversible, hence the confirm
  // (the server also restricts it to admins in a community brain).
  const handlePurgeTrash = useCallback(
    (id: string) => {
      if (!communityId) return
      const name = trash.find((t) => t.id === id)?.name ?? 'this note'
      if (!window.confirm(`Permanently delete “${name}”? This cannot be undone.`)) return
      notesApi
        .purgeTrash(communityId, id)
        .then(() => setTreeVersion((v) => v + 1))
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to delete the note')
        })
    },
    [communityId, trash],
  )

  const handleEmptyTrash = useCallback(() => {
    if (!communityId) return
    const count = trash.length
    if (!window.confirm(`Permanently delete ${count === 1 ? 'the note' : `all ${count} notes`} in the trash? This cannot be undone.`)) return
    notesApi
      .emptyTrash(communityId)
      .then(() => setTreeVersion((v) => v + 1))
      .catch((e: unknown) => {
        window.alert(e instanceof Error ? e.message : 'Failed to empty the trash')
      })
  }, [communityId, trash])

  return {
    tree,
    notes,
    starred,
    trash,
    loading,
    error,
    folderBadges,
    rootFolder,
    shareTarget,
    setShareTarget,
    handleToggleStar,
    handleDeleteNote,
    handleDeleteFolder,
    handleRestoreTrash,
    handlePurgeTrash,
    handleEmptyTrash,
  }
}
