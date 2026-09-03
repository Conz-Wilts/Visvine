/**
 * Structural guard: no route under /api/notes may reach the raw note store
 * without also naming a permission gate.
 *
 * lib/notes/store.ts is the storage layer — its functions take a `Context`
 * (spaceId + ownerKey), NOT a ContextPrincipal, so they answer "what is in this
 * space" with no regard for who is asking. That is by design; the grant model
 * lives one layer up (lib/notes/contextService.ts + shared/permissions.ts). The
 * failure mode is therefore always the same shape: a route calls a store
 * function directly and forgets the gate, and space membership silently becomes
 * the only check. Three routes had exactly that bug — history (GET leaked every
 * note's revision bodies, POST let any member overwrite any note), trash (GET
 * leaked the paths of trashed notes in unreadable folders) and trash/restore
 * (any member could resurrect any note into a folder they cannot write).
 *
 * This is a source-text check, not a behavioural one: it proves a gate is
 * *named*, not that it is correct or reachable on every branch. It is cheap,
 * needs no database, and catches the "forgot it entirely" case that actually
 * happens. Route-level behaviour is covered by the unit tests over the
 * predicates themselves (context-permissions.test.ts).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/notes-route-gates.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROUTES_DIR = new URL('../app/api/notes', import.meta.url).pathname

/** Store functions that read or write note content with no principal. */
const RAW_STORE = [
  'listRevisions',
  'applyRevision',
  'listTrash',
  'restoreTrash',
  'emptyTrash',
  'purgeTrashEntry',
  'writeNote',
  'createNote',
  'deleteNote',
  'readNote',
  'readNoteOrNull',
  'renameNote',
  'listRaw',
  'listFolders',
  'createFolder',
  'createIndexFolder',
  'renameFolder',
  'deleteFolder',
]

/**
 * Anything that folds the caller's standing into the decision. Deliberately
 * broad — the point is to catch a route with NO gate at all, not to police
 * which gate was chosen.
 */
const GATES = [
  'readVisible',
  'visibleVault',
  'canReadPath',
  'writeDenial',
  'writeDenialFull',
  'writeGated',
  'moveGated',
  'canRemove',
  'principalCanRead',
  'principalCanWrite',
  'principalCanManage',
  'principalSeesFolder',
  'principalIsSuperAdmin',
  'reorganizeDenial',
  'isAdmin',
  'Gated(', // createSourceGated, deleteSourceGated, reingestSourceGated, …
]

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...routeFiles(full))
    else if (entry.name === 'route.ts') out.push(full)
  }
  return out
}

const files = routeFiles(ROUTES_DIR)

test('there are notes routes to check (the walker did not silently find nothing)', () => {
  assert.ok(files.length >= 15, `expected the notes route tree, found ${files.length} files`)
})

for (const file of files) {
  const rel = file.slice(file.indexOf('app/api/notes'))
  const src = readFileSync(file, 'utf8')
  const raw = RAW_STORE.filter((fn) => new RegExp(`\\b${fn}\\b`).test(src))
  if (raw.length === 0) continue

  test(`${rel} gates its raw store access`, () => {
    const found = GATES.filter((g) => src.includes(g))
    assert.ok(
      found.length > 0,
      `${rel} calls ${raw.join(', ')} from lib/notes/store but names no permission gate — ` +
        `space membership would be the only check. Add the gate that fits the operation ` +
        `(readVisible for a read, writeDenialFull for a content write, context.isAdmin for ` +
        `a space-wide destructive action).`,
    )
  })
}
