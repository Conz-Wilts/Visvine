// Where a space's landing folders are (lib/notes/shared/namespaces.ts).
//
// `agents/`, `tools/`, `connectors/` and `models/` are where a new thing of
// their kind is written. A space may move one into a folder of its own — the
// index of wherever it went says `home: <dir>` — or delete it while it holds
// nothing, which the root index records as `hidden: [<dir>]` — from then on
// it appears only while something is in it, like any other folder. Both live on
// index notes for the reason placements do: the fact is about that folder, it
// follows the folder through a rename and the trash, and the tree already
// reads every index's frontmatter.

import prisma from '@/lib/prisma'
import { parseFrontmatter, joinFrontmatter, splitFrontmatter } from './shared/markdown'
import { HIDDEN_KEY, HOME_KEY, hiddenLandingsOf, isLandingDir, landingHomesFrom } from './shared/namespaces'
import type { Context } from './store'

const INDEX = 'index.md'

/** Every moved landing folder in a context: dir → where it is. */
export async function landingHomes(context: Context): Promise<Map<string, string>> {
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: null,
      path: { endsWith: `/${INDEX}` },
      content: { contains: `${HOME_KEY}:` },
    },
    select: { path: true, content: true },
  })
  return landingHomesFrom(rows.map((r) => ({ path: r.path, frontmatter: parseFrontmatter(r.content) })))
}

/** Where a new thing of `dir`'s kind is written: the moved folder, else `dir`. */
export async function landingFolderOf(context: Context, dir: string): Promise<string> {
  return (await landingHomes(context)).get(dir) ?? dir
}

/** The frontmatter of `content` with `key` set to `value`, or removed when it is null. */
function withKey(content: string, key: string, value: unknown): string {
  const fm = parseFrontmatter(content) as Record<string, unknown>
  const { body } = splitFrontmatter(content)
  if (value === null || (Array.isArray(value) && value.length === 0)) delete fm[key]
  else fm[key] = value
  return joinFrontmatter(fm, body)
}

/**
 * The index content that makes `folder` the landing folder for `dir`, or —
 * when it went back to `dir` itself — no longer says so. `current` is the
 * index as it stands (null for none).
 */
export function homeIndexContent(current: string | null, folder: string, dir: string): string {
  const base = current ?? `---\ntitle: ${folder.slice(folder.lastIndexOf('/') + 1)}\n---\n`
  return withKey(base, HOME_KEY, folder === dir ? null : dir)
}

/** The root index with `dir` added to (or taken out of) the deleted landing folders. */
export function hiddenIndexContent(current: string | null, dir: string, hidden: boolean): string {
  if (!isLandingDir(dir)) return current ?? ''
  const base = current ?? '---\n---\n'
  const list = new Set(hiddenLandingsOf(parseFrontmatter(base) as Record<string, unknown>))
  if (hidden) list.add(dir)
  else list.delete(dir)
  return withKey(base, HIDDEN_KEY, [...list].sort())
}
