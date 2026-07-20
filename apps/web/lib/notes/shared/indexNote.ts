// Per-folder index notes (the blackbird-brain convention): every folder carries
// an `index.md` — a `type: Index` note titling the folder and listing its notes.
// These are the pure path/content helpers; the DB side (ensureAncestorIndexes)
// lives in lib/notes/store.ts. No fs/DOM access, unit-testable like the rest of
// lib/notes/shared/*.

export const INDEX_BASENAME = 'index.md'

// 'people/index.md' → true; 'index.md' (brain root) → true.
export function isIndexPath(path: string): boolean {
  return path === INDEX_BASENAME || path.endsWith(`/${INDEX_BASENAME}`)
}

// 'people' → 'people/index.md'
export function indexPathOf(folder: string): string {
  return `${folder}/${INDEX_BASENAME}`
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

// The auto-created index stub: folder title + a linked list of its current
// direct-child notes (absolute /path.md links, matching the seeded indexes).
// Only ever used for MISSING indexes — existing (curated) ones are never rewritten.
export function buildIndexStub(
  folderPath: string,
  children: { path: string; title: string }[],
): string {
  const name = folderPath.split('/').pop() ?? folderPath
  const lines = [...children]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((c) => `- [${c.title}](/${c.path})`)
  return (
    `---\n` +
    `type: Index\n` +
    `title: ${JSON.stringify(humanizeFolderName(name))}\n` +
    `tags: []\n` +
    `---\n` +
    (lines.length > 0 ? `\n${lines.join('\n')}\n` : '')
  )
}
