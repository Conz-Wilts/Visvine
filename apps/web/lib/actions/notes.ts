/**
 * The action notes: what an agent reads to learn what Visvine can do.
 *
 * Every action's guidance and every recipe is a note in the `visvine` global
 * space (lib/spaces/globalSpace.ts) — `actions/<name>.md` and
 * `recipes/<id>.md`. That space is readable by every signed-in user and
 * writable only by super-admins, which is exactly the audience shape this
 * content wants: everyone reads the manual, one person maintains it.
 *
 * WHY NOTES AND NOT CODE. This app's whole premise is that context notes are
 * how you direct an agent, and a surface that declared its own capabilities in
 * a protocol rather than in notes would contradict it. The manual is fetched on
 * demand, in the same medium as everything else the platform holds, and it costs
 * a client nothing until it asks.
 *
 * WHAT A NOTE CANNOT DO. It cannot create an action, rename one, or change the
 * scope one needs — `runAction` resolves names against the registry and reads
 * the scope from the definition. A note found here for an action that no longer
 * exists is dropped on read. Prose in these notes is guidance, and guidance is
 * all it is; the split is the same one connectors make between their
 * frontmatter and their body.
 *
 * Reads go through the store with a system context rather than through
 * `resolveContext`, deliberately: the catalogue is product documentation, not
 * tenant data, and every authenticated caller is entitled to all of it.
 */
import { humanizeFolderName } from '@/lib/notes/shared/indexNote'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { GLOBAL_SPACE_ID } from '@/lib/spaces/globalSpace'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { KeywordRule } from '@/lib/actions/shared/match'
import { actionByName } from '@/lib/actions/registry'
import { guideById } from '@/lib/actions/shared/guides'
import { allRecipes, orientRecipe, renderRecipeBody } from '@/lib/actions/recipes'

export const ACTIONS_FOLDER = 'actions'
export const RECIPES_FOLDER = 'recipes'
export const GUIDES_FOLDER = 'guides'

export function guideNotePath(id: string): string {
  return `${GUIDES_FOLDER}/${id}.md`
}

export function actionNotePath(name: string): string {
  return `${ACTIONS_FOLDER}/${name}.md`
}

export function recipeNotePath(id: string): string {
  return `${RECIPES_FOLDER}/${id}.md`
}

/** One action's entry in that Context. */
export interface ActionNote {
  name: string
  summary: string
  /** The prose an agent reads before calling it — everything below frontmatter. */
  body: string
}

/** One recipe's entry in that Context. */
export interface RecipeNote {
  id: string
  title: string
  when: string
  keywords: KeywordRule[]
  body: string
}

interface Row {
  path: string
  content: string
}

async function readFolder(folder: string): Promise<Row[]> {
  return prisma.contextNote.findMany({
    where: {
      spaceId: GLOBAL_SPACE_ID,
      ownerKey: 'shared',
      deletedAt: null,
      path: { startsWith: `${folder}/` },
    },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
}

function basename(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '')
}

/**
 * Keyword rules off a note's frontmatter, dropping anything malformed rather
 * than throwing. A hand-edited note with a bad rule should cost that rule, not
 * the whole catalogue.
 */
function keywordsFrom(raw: unknown): KeywordRule[] {
  if (!Array.isArray(raw)) return []
  const rules: KeywordRule[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { all, score } = entry as { all?: unknown; score?: unknown }
    if (!Array.isArray(all) || typeof score !== 'number' || !Number.isFinite(score)) continue
    const terms = all.filter((t): t is string => typeof t === 'string' && t.length > 0)
    if (terms.length) rules.push({ all: terms, score })
  }
  return rules
}

/**
 * Every action the action notes documents, keyed by name. An entry whose action no
 * longer exists in the registry is dropped — a stale note must never advertise
 * a call that will 404.
 */
export async function readActionNotes(): Promise<Map<string, ActionNote>> {
  const out = new Map<string, ActionNote>()
  let rows: Row[]
  try {
    rows = await readFolder(ACTIONS_FOLDER)
  } catch (err) {
    // The catalogue is documentation. Losing it must degrade the answer, never
    // fail the call — the registry below still knows every action's summary.
    logger.warn('actions.notes.unreadable', { err })
    return out
  }
  for (const row of rows) {
    const name = basename(row.path)
    if (name === 'index' || !actionByName(name)) continue
    const fm = parseFrontmatter(row.content)
    const { body } = splitFrontmatter(row.content)
    out.set(name, {
      name,
      summary: typeof fm.description === 'string' ? fm.description : '',
      body: body.trim(),
    })
  }
  return out
}

/**
 * The shipped catalogue, rendered in memory.
 *
 * The notes are an ENHANCEMENT, not a prerequisite: a deployment that has never
 * run `db:actions:sync` — or one that lost the notes — still answers every plan
 * from the same content, because the notes were only ever a rendering of this.
 * Syncing is what makes it editable in the app; it is not what makes it work.
 * Without this fallback, the order of two deploy steps would decide whether the
 * surface could route a request at all.
 */
function shippedRecipes(): RecipeNote[] {
  return [...allRecipes(), orientRecipe()].map((r) => ({
    id: r.id,
    title: humanizeFolderName(r.id),
    when: r.when,
    keywords: r.keywords,
    body: renderRecipeBody(r),
  }))
}

export async function readRecipeNotes(): Promise<RecipeNote[]> {
  let rows: Row[]
  try {
    rows = await readFolder(RECIPES_FOLDER)
  } catch (err) {
    logger.warn('actions.notes.unreadable', { err })
    return shippedRecipes()
  }
  const out: RecipeNote[] = []
  for (const row of rows) {
    const id = basename(row.path)
    if (id === 'index') continue
    const fm = parseFrontmatter(row.content) as Record<string, unknown>
    const { body } = splitFrontmatter(row.content)
    out.push({
      id,
      title: typeof fm.title === 'string' ? fm.title : humanizeFolderName(id),
      when: typeof fm.when === 'string' ? fm.when : '',
      keywords: keywordsFrom(fm.keywords),
      body: body.trim(),
    })
  }
  return out.length > 0 ? out : shippedRecipes()
}

/**
 * One action's note, or null when the action notes has never been synced — in which
 * case the caller falls back to the definition's own guidance. Losing the action notes
 * must cost the editable half of the documentation and nothing more, so a read
 * failure reads the same as an absent note.
 */
export async function readActionNote(name: string): Promise<ActionNote | null> {
  if (!actionByName(name)) return null
  let row: { content: string } | null
  try {
    row = await prisma.contextNote.findFirst({
      where: {
        spaceId: GLOBAL_SPACE_ID,
        ownerKey: 'shared',
        deletedAt: null,
        path: actionNotePath(name),
      },
      select: { content: true },
    })
  } catch (err) {
    logger.warn('actions.notes.unreadable', { err })
    return null
  }
  if (!row) return null
  const fm = parseFrontmatter(row.content)
  return {
    name,
    summary: typeof fm.description === 'string' ? fm.description : '',
    body: splitFrontmatter(row.content).body.trim(),
  }
}

/**
 * A guide's body as the note holds it, or null to fall back to the shipped
 * text — the same relationship an action note has with its definition.
 */
export async function readGuideNote(id: string): Promise<string | null> {
  if (!guideById(id)) return null
  let row: { content: string } | null
  try {
    row = await prisma.contextNote.findFirst({
      where: { spaceId: GLOBAL_SPACE_ID, ownerKey: 'shared', deletedAt: null, path: guideNotePath(id) },
      select: { content: true },
    })
  } catch (err) {
    logger.warn('actions.notes.unreadable', { err })
    return null
  }
  if (!row) return null
  const body = splitFrontmatter(row.content).body.trim()
  return body.length > 0 ? body : null
}
