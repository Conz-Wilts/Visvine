// Pure helpers behind the "Create new → Context / File" flows: turning a typed
// title into a brain path, and composing the seed note body. Kept out of the
// modal so both the client (path preview, optimistic routing) and the tests use
// one implementation. Pure — no Node/DOM/Prisma imports.

/**
 * A title as a filename segment: lowercased, punctuation dropped, spaces to
 * hyphens. Mirrors the entity-note slug style (people/craig-piggott.md) so a
 * hand-made note sits beside generated ones without looking foreign.
 */
export function noteFileSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'untitled'
}

/** Join a folder ('' = brain root) and a filename into a brain-relative path. */
export function joinBrainPath(folder: string, filename: string): string {
  const dir = folder.replace(/^\/+|\/+$/g, '')
  return dir ? `${dir}/${filename}` : filename
}

/** Destination path for a new note: `<folder>/<slug>.md`. */
export function composeNotePath(folder: string, title: string): string {
  return joinBrainPath(folder, `${noteFileSlug(title)}.md`)
}

/**
 * The first free path in `folder` for `title` — appends -2, -3… when taken.
 * `taken` is the set of existing note paths (the loaded tree/index), so the
 * modal can show the real destination before it writes rather than failing on
 * the store's unique-path error.
 */
export function availableNotePath(folder: string, title: string, taken: Set<string>): string {
  const base = noteFileSlug(title)
  let candidate = joinBrainPath(folder, `${base}.md`)
  let n = 2
  while (taken.has(candidate)) candidate = joinBrainPath(folder, `${base}-${n++}.md`)
  return candidate
}

/**
 * The first free folder path inside `parent` for `title` — appends -2, -3… when
 * taken, exactly like availableNotePath. `taken` is the set of existing folder
 * paths, so the create surface shows the real destination before it writes.
 *
 * A folder IS its index note, so this is where "New index" lands.
 */
export function availableFolderPath(parent: string, title: string, taken: Set<string>): string {
  const base = noteFileSlug(title)
  let candidate = joinBrainPath(parent, base)
  let n = 2
  while (taken.has(candidate)) candidate = joinBrainPath(parent, `${base}-${n++}`)
  return candidate
}

/**
 * Seed body for a new note — the same frontmatter shape the notes API writes
 * for a bare create (type/title/author/tags), plus an H1 and any starting text
 * the user typed in the modal.
 */
export function newNoteContent(input: {
  title: string
  author?: string
  tags?: string[]
  body?: string
}): string {
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean)
  const authorLine = input.author ? `author: ${input.author}\n` : ''
  const body = (input.body ?? '').trim()
  return (
    `---\n` +
    `type: Note\n` +
    `title: ${input.title}\n` +
    authorLine +
    `tags: [${tags.join(', ')}]\n` +
    `---\n\n` +
    `# ${input.title}\n\n` +
    (body ? `${body}\n` : '')
  )
}
