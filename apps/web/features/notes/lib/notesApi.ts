// Typed client for the notes REST API. Every call is scoped to a brain
// (communityId + scope). Reads use query params; mutations send a JSON body that
// also carries communityId/scope (see lib/notes/api.ts:requireBrain). Plain fetch
// + thrown errors, matching Visvine's client conventions (no SWR/react-query).

import type {
  NoteMeta,
  TreeNode,
  GraphData,
  References,
  NoteRevision,
  TrashEntry,
  RelatedNote,
  ReorganizePlan,
} from '@/lib/notes/shared/types'
import type { LinkInsights, TagCount } from '@/lib/notes/shared/insights'

export type Scope = 'shared' | 'personal'

function qs(communityId: string, scope: Scope, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ communityId, scope, ...(extra ?? {}) })
  return params.toString()
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

async function sendJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export const notesApi = {
  config: () => getJson<{ aiConfigured: boolean }>('/api/notes/config'),

  list: (c: string, s: Scope) =>
    getJson<{ notes: NoteMeta[]; pinned: string[] }>(`/api/notes?${qs(c, s)}`),
  tree: (c: string, s: Scope) => getJson<{ tree: TreeNode }>(`/api/notes/tree?${qs(c, s)}`),
  graph: (c: string, s: Scope) =>
    getJson<{ graph: GraphData; insights: LinkInsights; tags: TagCount[] }>(
      `/api/notes/graph?${qs(c, s)}`,
    ),

  read: (c: string, s: Scope, path: string) =>
    getJson<{ content: string }>(`/api/notes/item?${qs(c, s, { path })}`),
  create: (c: string, s: Scope, path: string, content?: string) =>
    sendJson<{ note: NoteMeta | null }>('/api/notes/item', 'POST', {
      communityId: c,
      scope: s,
      path,
      content,
    }),
  write: (c: string, s: Scope, path: string, content: string, origin?: string) =>
    sendJson<{ ok: true }>('/api/notes/item', 'PUT', {
      communityId: c,
      scope: s,
      path,
      content,
      origin,
    }),
  rename: (c: string, s: Scope, from: string, to: string) =>
    sendJson<{ path: string }>('/api/notes/item', 'PATCH', { communityId: c, scope: s, from, to }),
  remove: async (c: string, s: Scope, path: string) => {
    const res = await fetch(`/api/notes/item?${qs(c, s, { path })}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
    }
    return res.json() as Promise<{ ok: true }>
  },

  references: (c: string, s: Scope, path: string) =>
    getJson<{ references: References }>(`/api/notes/references?${qs(c, s, { path })}`),
  related: (c: string, s: Scope, path: string) =>
    getJson<{ related: RelatedNote[] }>(`/api/notes/related?${qs(c, s, { path })}`),

  history: (c: string, s: Scope, path: string) =>
    getJson<{ revisions: NoteRevision[] }>(`/api/notes/history?${qs(c, s, { path })}`),
  restoreRevision: (c: string, s: Scope, path: string, revisionId: string) =>
    sendJson<{ ok: true }>('/api/notes/history', 'POST', {
      communityId: c,
      scope: s,
      path,
      revisionId,
    }),

  createFolder: (c: string, s: Scope, path: string) =>
    sendJson<{ ok: true }>('/api/notes/folders', 'POST', { communityId: c, scope: s, path }),
  renameFolder: (c: string, s: Scope, from: string, to: string) =>
    sendJson<{ path: string }>('/api/notes/folders', 'PATCH', { communityId: c, scope: s, from, to }),
  deleteFolder: async (c: string, s: Scope, path: string) => {
    const res = await fetch(`/api/notes/folders?${qs(c, s, { path })}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
    }
    return res.json() as Promise<{ ok: true }>
  },

  trash: (c: string, s: Scope) => getJson<{ trash: TrashEntry[] }>(`/api/notes/trash?${qs(c, s)}`),
  restoreTrash: (c: string, s: Scope, id: string) =>
    sendJson<{ path: string }>('/api/notes/trash/restore', 'POST', { communityId: c, scope: s, id }),
  emptyTrash: (c: string, s: Scope) =>
    sendJson<{ ok: true }>('/api/notes/trash/empty', 'POST', { communityId: c, scope: s }),

  pin: (c: string, s: Scope, path: string, pinned: boolean) =>
    sendJson<{ ok: true }>('/api/notes/pin', 'POST', { communityId: c, scope: s, path, pinned }),

  refactor: (mode: 'note' | 'selection', text: string, instruction?: string) =>
    sendJson<{ result: string }>('/api/notes/ai/refactor', 'POST', { mode, text, instruction }),
  reorganize: (c: string, s: Scope) =>
    sendJson<{ plan: ReorganizePlan }>('/api/notes/ai/reorganize', 'POST', {
      communityId: c,
      scope: s,
    }),

  exportUrl: (c: string, s: Scope, path: string) => `/api/notes/export?${qs(c, s, { path })}`,
  exportAllUrl: (c: string, s: Scope) => `/api/notes/export/all?${qs(c, s)}`,
}
