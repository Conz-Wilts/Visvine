// Folder placement helpers. A shared-context note's governing folder is its
// TOP-LEVEL path segment ("deals/canva.md" → "deals"); root-level notes
// ("welcome.md") belong to the reserved ROOT folder, which every member may
// write to.

/** The reserved id for the shared context's root (notes with no top-level folder). */
const ROOT_FOLDER = ''

/** Top-level folder id of a context path ('' for a root-level note). */
export function folderIdOfPath(path: string): string {
  const slash = path.indexOf('/')
  return slash === -1 ? ROOT_FOLDER : path.slice(0, slash)
}
