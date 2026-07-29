// Folder placement helpers, ported from blackbird-brain's src/shared/placement.ts.
// In Visvine a shared-brain note's governing folder is its TOP-LEVEL path segment
// ("deals/canva.md" → "deals"); root-level notes ("welcome.md") belong to the
// reserved ROOT folder, which behaves like blackbird's company root except that
// every member may write (Visvine's pre-registry behavior is preserved).

/** The reserved id for the shared brain's root (notes with no top-level folder). */
const ROOT_FOLDER = ''

/** Top-level folder id of a brain path ('' for a root-level note). */
export function folderIdOfPath(path: string): string {
  const slash = path.indexOf('/')
  return slash === -1 ? ROOT_FOLDER : path.slice(0, slash)
}
