// What every record in the Directory has, whatever its type: when its note was
// last edited and by whom, and who added it. The
// table's core columns read these (lib/directory/table.ts).
//
// The dates are the NOTE's, not the node's. A node row is rewritten by
// housekeeping — identity binding, alias sync, the global record — so its
// `updatedAt` moves when nobody edited anything; the note moves only when
// someone (or an agent) wrote it.
//
// Read per request, outside the node cache: a note save does not bust the
// `context-data-v2` tag, so these would go stale inside it. And read through
// the viewer's lens — a note they cannot read contributes no editor, author or
// date, the way a link into it degrades to nothing.

import prisma from '@/lib/prisma'
import { agentOfRevisionStamp, entityNotePath } from '@/lib/notes/entities'
import { principalCanRead } from '@/lib/notes/shared/permissions'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { NBNode } from '@/lib/types'

export interface RecordFacts {
  updated_at?: string
  edited_by?: string
  added_by?: string
}

/** Who a revision names: the agent for an agent's run, else the person saving. */
export function editorOf(rev: { editor: string; origin: string; model: string | null }): string | null {
  const agent = agentOfRevisionStamp(rev.origin, rev.model ?? undefined)
  if (agent) return agent
  if (rev.origin === 'baseline' || !rev.editor || rev.editor === 'Unknown') return null
  return rev.editor
}

export async function recordFactsFor(
  spaceId: string,
  nodes: NBNode[],
  principal: ContextPrincipal,
): Promise<Map<string, RecordFacts>> {
  const facts = new Map<string, RecordFacts>()
  const nodeByPath = new Map<string, string>()
  for (const node of nodes) {
    const path = entityNotePath(node)
    if (path && principalCanRead(principal, path)) nodeByPath.set(path, node.id)
  }

  if (!nodeByPath.size) return facts
  const notes = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: 'shared', deletedAt: null, path: { in: [...nodeByPath.keys()] } },
    select: { id: true, path: true, updatedAt: true, createdBy: true },
  })

  const [revisions, authors] = await Promise.all([
    notes.length
      ? prisma.contextNoteRevision.findMany({
          where: { noteId: { in: notes.map((n) => n.id) } },
          orderBy: { at: 'desc' },
          distinct: ['noteId'],
          select: { noteId: true, editor: true, origin: true, model: true },
        })
      : Promise.resolve([]),
    notes.length
      ? prisma.user.findMany({
          where: { id: { in: [...new Set(notes.map((n) => n.createdBy))] } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ])
  const lastEditor = new Map(revisions.map((r) => [r.noteId, editorOf(r)]))
  const authorName = new Map(authors.map((u) => [u.id, u.name || u.email]))

  for (const note of notes) {
    const nodeId = nodeByPath.get(note.path)
    if (!nodeId) continue
    const added = authorName.get(note.createdBy) ?? undefined
    facts.set(nodeId, {
      updated_at: note.updatedAt.toISOString(),
      // A note never edited after it was written has no revision; its author
      // is then also its last editor.
      edited_by: lastEditor.get(note.id) ?? added,
      added_by: added,
    })
  }
  return facts
}
