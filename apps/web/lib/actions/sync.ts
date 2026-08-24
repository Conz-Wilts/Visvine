/**
 * Writing the action notes: the shipped defaults, into the Visvine global space.
 *
 * `pnpm --filter @visvine/web db:actions:sync` renders one note per action and
 * one per recipe into `visvine`'s shared context. It is idempotent, and it is
 * how a deployment gets them — the same relationship
 * `lib/connectors/catalog.ts` has with the connector notes a space ends up
 * holding: the catalogue in code is the default, the note is the live thing.
 *
 * WHAT IT WILL NOT OVERWRITE. An action note has two halves. The contract block
 * between `<!-- action:contract -->` markers is machine-maintained, regenerated
 * from the Zod schema on every sync, and never hand-written. Everything outside
 * those markers belongs to whoever maintains them — in production the
 * admin of the Visvine space, connor@visvine.com — and a sync leaves it exactly
 * as it found it. A note that does not exist yet is created with the
 * definition's own `description` as its prose, so a fresh deployment is
 * documented before anyone touches it.
 *
 * That asymmetry is the whole point. The half a model relies on to make a
 * correct call cannot drift from the code; the half that explains WHEN to make
 * it can be improved by a person, in the app, without a deploy.
 */
import { logger } from '@/lib/logger'
import { ensureGlobalSpace, GLOBAL_SPACE_ID, GLOBAL_SPACE_NAME } from '@/lib/spaces/globalSpace'
import { readNoteOrNull, writeNote, type Actor, type Context } from '@/lib/notes/store'
import { joinFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import { allActions } from '@/lib/actions/registry'
import { allRecipes, orientRecipe, renderRecipeBody } from '@/lib/actions/recipes'
import { ACTIONS_FOLDER, RECIPES_FOLDER, actionNotePath, recipeNotePath } from '@/lib/actions/notes'
import {
  applyContract,
  paramsOf,
  proseOutsideContract,
  renderContract,
} from '@/lib/actions/shared/contract'

/** Written by the platform itself, never attributed to a signed-in person. */
const ACTOR: Actor = { id: 'system', name: GLOBAL_SPACE_NAME, email: null }
const CONTEXT: Context = { spaceId: GLOBAL_SPACE_ID, ownerKey: 'shared' }


export interface SyncReport {
  actions: number
  recipes: number
}

export async function syncActionNotes(): Promise<SyncReport> {
  await ensureGlobalSpace()
  await writeIndexes()

  let actions = 0
  for (const def of allActions()) {
    const path = actionNotePath(def.name)
    const existing = await readNoteOrNull(CONTEXT, path)
    // Keep the maintainer's prose; replace only the generated contract.
    const prose = existing ? proseOutsideContract(splitFrontmatter(existing).body) : ''
    const block = renderContract({
      action: def.name,
      scope: def.scope,
      readOnly: def.annotations?.readOnlyHint === true,
      destructive: def.annotations?.destructiveHint === true,
      params: paramsOf(def.input),
    })
    const body = applyContract(prose.length > 0 ? prose : def.description, block)
    await writeNote(
      CONTEXT,
      path,
      joinFrontmatter(
        {
          title: def.name,
          description: def.summary,
          action: def.name,
          scope: def.scope,
        },
        body,
      ),
      ACTOR,
      'baseline',
    )
    actions += 1
  }

  let recipes = 0
  for (const recipe of [...allRecipes(), orientRecipe()]) {
    await writeNote(
      CONTEXT,
      recipeNotePath(recipe.id),
      joinFrontmatter(
        {
          title: recipe.id,
          description: recipe.when,
          recipe: recipe.id,
          when: recipe.when,
          keywords: recipe.keywords.map((r) => ({ score: r.score, all: r.all })),
        },
        renderRecipeBody(recipe),
      ),
      ACTOR,
      'baseline',
    )
    recipes += 1
  }

  logger.info('actions.notes.synced', { actions, recipes })
  return { actions, recipes }
}

const ACTIONS_INDEX = `Every action Visvine can be asked to perform, one note each.

An action is three things at once: an entry in the registry (\`lib/actions/registry.ts\`), an endpoint
(\`POST /api/actions/<name>\`), and the note you are reading. The registry decides what exists and what
scope it needs; the note explains when to use it and what will go wrong. Nothing written here can
create an action, rename one, or change the scope one requires.

Each note carries a generated contract between \`<!-- action:contract -->\` markers — regenerated from
the code on every sync, so it cannot drift. The prose around it is maintained by the admin of this
space, and a sync leaves it alone.`

const RECIPES_INDEX = `How to do the things Visvine gets asked for, one note each.

A recipe is the plan a request gets routed to: the ordered steps, the note contract where one applies,
and the refusals to expect. Matching is a weighted overlap over each note's \`keywords:\` — so adding a
recipe is writing a note here, and needs no deploy.

A recipe is advice, never authorization. Every step it names still runs through the same permission
gates, so a wrong recipe costs a refusal and nothing more.`

async function writeIndexes(): Promise<void> {
  await writeNote(
    CONTEXT,
    `${ACTIONS_FOLDER}/index.md`,
    joinFrontmatter({ title: 'Actions', description: 'What Visvine can be asked to do.' }, ACTIONS_INDEX),
    ACTOR,
    'baseline',
  )
  await writeNote(
    CONTEXT,
    `${RECIPES_FOLDER}/index.md`,
    joinFrontmatter(
      { title: 'Recipes', description: 'How to do the things Visvine gets asked for.' },
      RECIPES_INDEX,
    ),
    ACTOR,
    'baseline',
  )
}
