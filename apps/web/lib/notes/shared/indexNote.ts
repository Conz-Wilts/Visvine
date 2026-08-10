// Per-folder index notes: an index note and a folder are THE SAME THING. Every
// folder carries an `index.md` — a `type: Index` note whose title is the
// folder's display name and whose body lists the folder's notes. Creating an
// Index creates a folder; retyping a note to Index turns it into one.
//
// These are the pure path/content helpers; the DB side (ensureAncestorIndexes,
// createIndexFolder, convertNoteToIndex, refreshFolderIndex) lives in
// lib/notes/store.ts. No fs/DOM access, unit-testable like the rest of
// lib/notes/shared/*.

import { extractMarkdownLinks, parseFrontmatter } from './markdown'

export const INDEX_BASENAME = 'index.md'

// 'people/index.md' → true; 'index.md' (brain root) → true.
export function isIndexPath(path: string): boolean {
  return path === INDEX_BASENAME || path.endsWith(`/${INDEX_BASENAME}`)
}

// 'people' → 'people/index.md'; '' (the brain root) → 'index.md'.
export function indexPathOf(folder: string): string {
  return folder ? `${folder}/${INDEX_BASENAME}` : INDEX_BASENAME
}

// 'people/index.md' → 'people'; the brain root's index → '' (the root folder).
export function folderOfIndexPath(indexPath: string): string {
  return indexPath.slice(0, Math.max(0, indexPath.length - INDEX_BASENAME.length - 1))
}

// Does this note DECLARE itself an index? The type is what makes a note a
// folder, so this is the trigger for conversion — not the path.
export function isIndexContent(content: string): boolean {
  const declared = parseFrontmatter(content).type
  return typeof declared === 'string' && declared.trim().toLowerCase() === 'index'
}

// The folder a non-index note becomes when it is retyped to Index:
// 'a/b.md' → 'a/b'. Undefined for a path that is already an index.
export function indexFolderPathOf(notePath: string): string {
  return notePath.replace(/\.md$/i, '')
}

// Ancestor folders of a note path, shallowest first, excluding the brain root:
// 'a/b/c.md' → ['a', 'a/b']; 'welcome.md' → [].
export function ancestorFolders(notePath: string): string[] {
  const segments = notePath.split('/').slice(0, -1)
  return segments.map((_, i) => segments.slice(0, i + 1).join('/'))
}

// 'portfolio-companies' → 'Portfolio Companies' (split on -/_, title-case).
export function humanizeFolderName(segment: string): string {
  return segment
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * What a folder's index note should be titled after its path is renamed.
 *
 * The index title is the folder's display name, so the two can disagree on
 * purpose: `communities/` titled "Companies" is a folder somebody named. A path
 * rename must not silently overwrite that. So the title only follows the rename
 * while nobody has touched it — while it is still exactly what the folder name
 * would have produced (or the bare segment, as some seeded indexes carry).
 *
 * Returns the new title, or null to leave the current one alone. Renaming the
 * DISPLAY name is a different act: edit the index note's title.
 */
export function nextIndexTitle(
  oldSegment: string,
  newSegment: string,
  currentTitle: string | null | undefined,
): string | null {
  const current = (currentTitle ?? '').trim()
  const untouched = !current || current === humanizeFolderName(oldSegment) || current === oldSegment
  return untouched ? humanizeFolderName(newSegment) : null
}

// the managed child list
//
// An index body is curated prose PLUS a machine-maintained list of the folder's
// children. The two are kept apart by HTML comment markers (invisible in
// rendered markdown), so the store can refresh the list on every add/rename/
// delete in the folder without touching a word anybody wrote.
//
// The block lists what the prose does NOT already link. A curated index that
// walks through its own contents ("Companies, grouped by sector…") keeps that
// writing and grows an empty block; an index nobody has tended lists everything.
// Either way a note added to a folder shows up in its index — and stops showing
// up there the moment somebody gives it a proper mention above.

export const CHILDREN_OPEN = '<!-- index:children -->'
export const CHILDREN_CLOSE = '<!-- /index:children -->'

export interface IndexChild {
  path: string
  title: string
}

// Everything between the markers, inclusive. Non-greedy so a body carrying two
// blocks (hand-pasted) only ever has its first one managed.
const CHILDREN_BLOCK_RE = new RegExp(
  `${escapeRe(CHILDREN_OPEN)}[\\s\\S]*?${escapeRe(CHILDREN_CLOSE)}`,
)

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The marker-wrapped list of a folder's direct children, sorted by title.
// Absolute /path.md hrefs, matching how the seeded indexes link.
function renderChildrenBlock(children: IndexChild[]): string {
  const lines = [...children]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((c) => `- [${c.title}](/${c.path})`)
  return [CHILDREN_OPEN, ...lines, CHILDREN_CLOSE].join('\n')
}

export function hasChildrenBlock(content: string): boolean {
  return CHILDREN_BLOCK_RE.test(content)
}

/**
 * Put the current child list into an index note: replace the managed block in
 * place if it has one, otherwise append it to the end of the body. Frontmatter
 * and every curated line ride through untouched, and anything the curated part
 * already links is left out of the block rather than listed twice.
 *
 * Returns `content` byte-identical when nothing changed, so callers can skip
 * the write (and the revision) on a no-op refresh.
 */
export function applyChildrenBlock(content: string, children: IndexChild[]): string {
  const curated = content.replace(CHILDREN_BLOCK_RE, '')
  const linked = new Set(extractMarkdownLinks(curated).map((href) => href.replace(/^\//, '')))
  const block = renderChildrenBlock(children.filter((c) => !linked.has(c.path)))
  if (CHILDREN_BLOCK_RE.test(content)) {
    return content.replace(CHILDREN_BLOCK_RE, block)
  }
  return `${content.trimEnd()}\n\n${block}\n`
}

// The auto-created index stub: folder title + the managed child list. Only ever
// used for MISSING indexes — an existing (curated) index keeps its body, and
// only its managed block is refreshed.
export function buildIndexStub(folderPath: string, children: IndexChild[]): string {
  const name = folderPath.split('/').pop() ?? folderPath
  return (
    `---\n` +
    `type: Index\n` +
    `title: ${JSON.stringify(humanizeFolderName(name))}\n` +
    `tags: []\n` +
    `---\n\n` +
    `${renderChildrenBlock(children)}\n`
  )
}

/**
 * Seed body for an index somebody just created — the folder's home page. Mirrors
 * newNoteContent in ./newContext.ts (same frontmatter shape, H1, starting text),
 * with `type: Index` and an empty managed block the store fills as notes land.
 */
export function newIndexContent(input: {
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
    `type: Index\n` +
    `title: ${input.title}\n` +
    authorLine +
    `tags: [${tags.join(', ')}]\n` +
    `---\n\n` +
    `# ${input.title}\n\n` +
    (body ? `${body}\n\n` : '') +
    `${renderChildrenBlock([])}\n`
  )
}
