/**
 * The seed's write helpers. Everything the seed puts in a context goes through
 * the note store, the same door the editor, the API and MCP use — so the
 * directory links, folder indexes, entity folders, agent state and every other
 * projection are built by the app's own code, not re-derived afterwards by a
 * backfill that has to agree with it.
 */

import { createNote, readNoteOrNull, writeNote, type Actor, type Context } from '../../lib/notes/store'
import type { Note } from './notes'

/** Create the note, or save over it when something already stands there. */
export async function putNote(context: Context, path: string, content: string, actor: Actor): Promise<void> {
  if ((await readNoteOrNull(context, path)) === null) await createNote(context, path, content, actor)
  else await writeNote(context, path, content, actor)
}

/**
 * Parents before children, and a folder's own index before what it holds.
 *
 * A note landing in a folder makes the folder's index if none stands yet, so
 * writing a child first would leave the curated index to overwrite a stub —
 * harmless, but it costs a revision per folder and does twice the work.
 */
export function inWriteOrder(notes: Note[]): Note[] {
  const depth = (path: string) => path.split('/').length - (path.endsWith('/index.md') || path === 'index.md' ? 1 : 0)
  const isIndex = (path: string) => path === 'index.md' || path.endsWith('/index.md')
  return [...notes].sort(
    (a, b) =>
      depth(a.path) - depth(b.path) ||
      Number(isIndex(b.path)) - Number(isIndex(a.path)) ||
      a.path.localeCompare(b.path),
  )
}

export async function putNotes(context: Context, notes: Note[], actor: Actor): Promise<number> {
  for (const note of inWriteOrder(notes)) await putNote(context, note.path, note.content, actor)
  return notes.length
}

const HOUR = 3600_000
export const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR)
export const daysAgo = (d: number) => hoursAgo(d * 24)
