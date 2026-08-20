'use client'

// The space context tree, loaded once and owned in one place.
//
// Rendered by the docked ContextSidebar (portalled into the global Sidebar
// from a note, a source or a profile) — the loading, the trash, the access
// badges and every mutation live here rather than in the component.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { contextDisplayName } from '@/lib/notes/shared/contextSettings'
import { entityKindOfPath, entityOwnerPathOf, isEntityNamespaceDir, noteHref } from '@/lib/notes/entities'
import { isIndexPath } from '@/lib/notes/shared/indexNote'
import type { NoteMeta, TreeNode, TrashEntry } from '@/lib/notes/shared/types'
import { notesApi, type AccessOverviewResponse } from './notesApi'
import { contextKeys, invalidateContextCache, swrFetch, watchContextCache } from './contextPrefetch'

const EMPTY_TREE: TreeNode = { name: '', path: '', kind: 'folder', children: [] }

/** Where a surface sends the user when the note it was showing is deleted:
 *  the context's root index note, the space's home page. */
const CONTEXT_HOME = '/directory/note/index.md'

/** What a move produces: the item keeps its own name under `destFolder`
 *  ('' = the context root). */
function movedPath(from: string, destFolder: string): string {
  const name = from.split('/').pop() ?? from
  return destFolder ? `${destFolder}/${name}` : name
}

/** The folder a path currently sits in ('' for a root-level item). */
export function parentFolderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/**
 * Why this move is impossible, or null when it's allowed. These are the
 * STRUCTURAL rules — an entity note IS its path (every [[mention]] and every
 * profile's Context tab resolves against people/<slug>.md, see
 * lib/notes/entities), so entity namespaces can neither be moved nor take in
 * anything else. Permission is a separate question the server answers; the tree
 * can't know each viewer's level per folder, so a rejected move surfaces the
 * server's message instead of being predicted here.
 */
export function moveDenial(from: string, kind: 'note' | 'folder', destFolder: string): string | null {
  // Into an entity's OWN folder (people/<slug>) is fine — that files the note
  // under the entity (and converts its note to the folder if needed). Into the
  // namespace root, or beside it as a would-be entity, is not.
  const intoEntityFolder = destFolder !== '' && entityOwnerPathOf(`${destFolder}/x.md`) !== null
  if (destFolder && !intoEntityFolder && (isEntityNamespaceDir(destFolder) || entityKindOfPath(`${destFolder}/x.md`))) {
    const ns = destFolder.split('/')[0]
    return `“${ns}” holds the notes for directory entities — those paths are managed. Drop onto a person or organisation to file a note under them.`
  }
  if (kind === 'note') {
    const ns = entityKindOfPath(from)
    if (ns) {
      return 'This is a directory entity’s note. It stays in its own folder so mentions of it, and its profile’s Context tab, keep resolving.'
    }
    if (isIndexPath(from)) {
      return 'This note is its folder’s home page — move the folder itself and the note goes with it.'
    }
    return null
  }
  if (!from) return 'The context root can’t be moved.'
  if (isEntityNamespaceDir(from)) {
    return `“${from}” is a managed folder of entity notes — it can’t be moved.`
  }
  if (entityOwnerPathOf(`${from}/x.md`) !== null && entityKindOfPath(`${from}/index.md`)) {
    return 'This folder is a directory entity’s context — its name is the entity, so it stays where it is.'
  }
  if (intoEntityFolder) {
    return 'Only notes can be filed under an entity — move the folder’s notes across one at a time.'
  }
  if (destFolder === from || destFolder.startsWith(`${from}/`)) {
    return 'A folder can’t be moved inside itself.'
  }
  return null
}

/** Whether a drop on `destFolder` would do anything (legal AND a real change). */
export function canMoveInto(from: string, kind: 'note' | 'folder', destFolder: string): boolean {
  return moveDenial(from, kind, destFolder) === null && destFolder !== parentFolderOf(from)
}

export interface ContextTreeOptions {
  spaceId: string | null
  /** False while the notes tool is off — no fetching, empty tree. */
  enabled: boolean
  /** The note the host surface currently has open, if any. Deleting it navigates home. */
  currentPath?: string | null
}

export function useContextTree({ spaceId, enabled, currentPath = null }: ContextTreeOptions) {
  const router = useRouter()
  const { currentSpace } = useSpace()

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
  // Bumped when something outside the tree invalidates the tree/list cache —
  // a save from the note panel, a create, a share. Separate from treeVersion so
  // an ordinary save doesn't also re-fetch the trash.
  const [listVersion, setListVersion] = useState(0)

  const active = enabled && !!spaceId

  // Load the tree + note index whenever the active space changes, through
  // the shared context cache: a cached value paints synchronously (re-opening
  // the Context tab shows the tree instantly, no spinner) and revalidates in
  // the background; the list fetch is deduped with EntityContextPanel's. A
  // gated or empty context simply yields an empty tree (no error surfaced).
  useEffect(() => {
    if (!spaceId || !active) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      swrFetch(contextKeys.tree(spaceId), () => notesApi.tree(spaceId), ({ tree }) => {
        if (!cancelled) setTree(tree ?? EMPTY_TREE)
      }),
      swrFetch(contextKeys.list(spaceId), () => notesApi.list(spaceId), ({ notes, starred }) => {
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
  }, [spaceId, active, treeVersion, listVersion])

  // The tree and the note index live in state here, but every other surface
  // that writes a note (the note panel, the entity panel, create, share) knows
  // only to invalidate the cache. Watching those keys is what turns such a write
  // into a repaint — star a note from the editor toolbar, or retitle it, and the
  // sidebar follows without a reload.
  useEffect(() => {
    if (!spaceId || !active) return
    // Coalesced: an editor autosave invalidates on every debounced flush, and
    // one refetch after the typing settles is what the tree needs.
    let timer: ReturnType<typeof setTimeout> | null = null
    const unwatch = watchContextCache([contextKeys.tree(spaceId), contextKeys.list(spaceId)], () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setListVersion((v) => v + 1), 300)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unwatch()
    }
  }, [spaceId, active])

  // The context's trash, for the folder pinned to the bottom of the tree. Re-runs
  // on treeVersion so a delete lands in the trash row immediately; the GET also
  // purges anything past its retention window, so the list is what the server
  // would keep. A failure just leaves the row empty.
  useEffect(() => {
    if (!spaceId || !active) return
    let cancelled = false
    notesApi
      .trash(spaceId)
      .then(({ trash }) => {
        if (!cancelled) setTrash(trash ?? [])
      })
      .catch(() => {
        if (!cancelled) setTrash([])
      })
    return () => {
      cancelled = true
    }
  }, [spaceId, active, treeVersion])

  // The context's display name for the header (renameable from the console).
  // Failure just leaves the default label — never blocks the tree.
  useEffect(() => {
    setContextName(null)
    if (!spaceId || !active) return
    let cancelled = false
    swrFetch(
      contextKeys.settings(spaceId),
      () => notesApi.getContextSettings(spaceId),
      ({ settings }) => {
        if (!cancelled) setContextName(settings?.contextName ?? null)
      },
    ).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [spaceId, active])

  // Access overview: restricted/locked boundaries (folders AND private notes)
  // for the 🔒 badges. Personal spaces have no boundaries — skip the fetch.
  // shareOpen is a dep so closing the Share panel repaints badges it changed.
  const shareOpen = shareTarget !== null
  useEffect(() => {
    if (!spaceId || !active || spaceId.startsWith('me:')) {
      setOverview(null)
      return
    }
    let cancelled = false
    notesApi
      .getAccessOverview(spaceId)
      .then((o) => {
        if (!cancelled) setOverview(o)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [spaceId, active, shareOpen])

  const folderBadges = useMemo(() => {
    if (!overview) return undefined
    const map = new Map<string, { restricted: boolean; locked?: boolean }>()
    for (const path of overview.restricted) map.set(path, { restricted: true })
    for (const path of overview.locked) {
      map.set(path, { ...(map.get(path) ?? { restricted: false }), locked: true })
    }
    return map.size ? map : undefined
  }, [overview])

  // The space as the tree's root folder — everything below it is literally
  // its children, so it renders as a folder row (chevron + name, no glyph)
  // rather than a separate header bar above the list. A renamed context wins
  // the label; the generic default defers to the space name.
  const rootFolder = useMemo(
    () => ({ label: contextDisplayName(contextName, currentSpace?.name) }),
    [contextName, currentSpace?.name],
  )

  const handleToggleStar = useCallback(
    (path: string, next: boolean) => {
      if (!spaceId) return
      // Optimistic: reflect the toggle immediately, revert on failure.
      setStarred((prev) => (next ? [...prev, path] : prev.filter((p) => p !== path)))
      notesApi
        .star(spaceId, path, next)
        .then(() => {
          // The cached list carries `starred` — drop it so the next open
          // doesn't repaint the pre-toggle state.
          invalidateContextCache(contextKeys.list(spaceId))
        })
        .catch(() => {
          setStarred((prev) => (next ? prev.filter((p) => p !== path) : [...prev, path]))
        })
    },
    [spaceId],
  )

  // Delete = move to the context's trash (restorable from the tree's Trash folder
  // for 7 days, then purged). Authority is enforced server-side per note — the
  // menu can't know each viewer's level, so a rejected delete just surfaces its
  // message. Deleting the note that's open navigates back to the browser.
  const handleDeleteNote = useCallback(
    (path: string) => {
      if (!spaceId) return
      const title = notes.find((n) => n.path === path)?.title ?? path
      if (!window.confirm(`Delete “${title}”? It moves to Trash and can be restored for 7 days.`)) return
      notesApi
        .remove(spaceId, path)
        .then(() => {
          invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
          setTreeVersion((v) => v + 1)
          if (path === currentPath) router.push(CONTEXT_HOME)
        })
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to delete the note')
        })
    },
    [spaceId, notes, currentPath, router],
  )

  // Deleting a folder trashes every note inside it, so the confirm spells that
  // out with the actual count. Same server-side authority + trash semantics as
  // a single note; navigates home if the open note lived inside the folder.
  const handleDeleteFolder = useCallback(
    // `label` is the name the row showed — a folder's index-note title when it
    // has one. The confirm has to name the folder the user clicked, not the path
    // segment behind it.
    (folderPath: string, label?: string) => {
      if (!spaceId) return
      const name = label?.trim() || folderPath.split('/').pop() || folderPath
      const count = notes.filter((n) => n.path.startsWith(`${folderPath}/`)).length
      const contents =
        count === 0
          ? 'It is empty.'
          : `This will also delete the ${count === 1 ? 'note' : `${count} notes`} inside it (moved to Trash, restorable for 7 days).`
      if (!window.confirm(`Delete the folder “${name}”? ${contents}`)) return
      notesApi
        .deleteFolder(spaceId, folderPath)
        .then(() => {
          invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
          setTreeVersion((v) => v + 1)
          if (currentPath?.startsWith(`${folderPath}/`)) router.push(CONTEXT_HOME)
        })
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to delete the folder')
        })
    },
    [spaceId, notes, currentPath, router],
  )

  // Moving a note = a rename to the same filename under another folder. The
  // server rewrites every inbound link to the new path, so the only client-side
  // work is the optimistic-free reload + following the note if it was open.
  const handleMoveNote = useCallback(
    (from: string, destFolder: string) => {
      if (!spaceId) return
      const to = movedPath(from, destFolder)
      const denial = moveDenial(from, 'note', destFolder)
      if (denial) return window.alert(denial)
      if (to === from) return
      notesApi
        .rename(spaceId, from, to)
        .then(({ path }) => {
          invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
          setTreeVersion((v) => v + 1)
          // The server may suffix the name if the destination was taken — follow
          // the path it actually wrote, not the one we asked for.
          if (from === currentPath) router.replace(noteHref(path))
        })
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to move the note')
        })
    },
    [spaceId, currentPath, router],
  )

  // Moving a folder takes its whole subtree with it (renameFolder server-side),
  // so an open note inside it follows to the equivalent path.
  const handleMoveFolder = useCallback(
    (from: string, destFolder: string) => {
      if (!spaceId) return
      const to = movedPath(from, destFolder)
      const denial = moveDenial(from, 'folder', destFolder)
      if (denial) return window.alert(denial)
      if (to === from) return
      notesApi
        .renameFolder(spaceId, from, to)
        .then(({ path }) => {
          invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
          setTreeVersion((v) => v + 1)
          if (currentPath?.startsWith(`${from}/`)) {
            router.replace(noteHref(`${path}${currentPath.slice(from.length)}`))
          }
        })
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to move the folder')
        })
    },
    [spaceId, currentPath, router],
  )

  // Restoring puts the note back at its original path (suffixed if something
  // else took it while it sat in the trash) — bumping treeVersion reloads the
  // tree, the note list and the trash together.
  const handleRestoreTrash = useCallback(
    (id: string) => {
      if (!spaceId) return
      notesApi
        .restoreTrash(spaceId, id)
        .then(() => {
          invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId))
          setTreeVersion((v) => v + 1)
        })
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to restore the note')
        })
    },
    [spaceId],
  )

  // Force-delete, ahead of the 7-day retention. Irreversible, hence the confirm
  // (the server also restricts it to admins in a space context).
  const handlePurgeTrash = useCallback(
    (id: string) => {
      if (!spaceId) return
      const name = trash.find((t) => t.id === id)?.name ?? 'this note'
      if (!window.confirm(`Permanently delete “${name}”? This cannot be undone.`)) return
      notesApi
        .purgeTrash(spaceId, id)
        .then(() => setTreeVersion((v) => v + 1))
        .catch((e: unknown) => {
          window.alert(e instanceof Error ? e.message : 'Failed to delete the note')
        })
    },
    [spaceId, trash],
  )

  const handleEmptyTrash = useCallback(() => {
    if (!spaceId) return
    const count = trash.length
    if (!window.confirm(`Permanently delete ${count === 1 ? 'the note' : `all ${count} notes`} in the trash? This cannot be undone.`)) return
    notesApi
      .emptyTrash(spaceId)
      .then(() => setTreeVersion((v) => v + 1))
      .catch((e: unknown) => {
        window.alert(e instanceof Error ? e.message : 'Failed to empty the trash')
      })
  }, [spaceId, trash])

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
    handleMoveNote,
    handleMoveFolder,
    handleRestoreTrash,
    handlePurgeTrash,
    handleEmptyTrash,
  }
}
