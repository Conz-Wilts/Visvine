/**
 * The guide: what the one tool answers with when it is not running anything.
 *
 * Two modes, and the split is the whole point of this surface.
 *
 *   PLAN  no action named. Returns the catalogue of what Visvine can do and,
 *         when a request is given, the recipe that answers it — read from the
 *         notes, ranked by a pure keyword match.
 *   DOCS  an action named but no input. Returns that action's note.
 *
 * Both render markdown, because both are documents, and a note handed back as a
 * note is the cheapest thing for a model to read.
 *
 * The catalogue is assembled from the REGISTRY and annotated from the NOTES,
 * never the other way round. An action with no note still lists, with the
 * summary its definition carries; a note naming an action the registry does not
 * have is dropped upstream in lib/actions/notes.ts. The surface can therefore
 * never advertise a call that does not exist, however stale the notes get.
 */
import { allActions, actionByName } from '@/lib/actions/registry'
import { readActionNotes, readRecipeNotes, readActionNote } from '@/lib/actions/notes'
import { scoreCandidates, confidenceOf } from '@/lib/actions/shared/match'
import { paramsOf, renderContract, proseOutsideContract } from '@/lib/actions/shared/contract'
import { spaceFactsFor } from '@/lib/actions/spaceFacts'
import type { ActionCaller, ActionDef } from '@/lib/actions/types'
import { recipeById, type PlanSpaceFacts } from '@/lib/actions/recipes'

/** The two-paragraph preamble every plan carries. It is the protocol. */
const HOW_IT_WORKS = [
  'Visvine has ONE tool and a catalogue of actions behind it.',
  '',
  '- `visvine({ request: "<what the user asked, verbatim>", space_id })` — this document: the plan, and everything that exists.',
  '- `visvine({ action: "<name>" })` — that action\'s manual: what it does, every argument, the traps.',
  '- `visvine({ action: "<name>", input: { … } })` — run it. Supplying `input` is what runs it, so nothing changes by accident.',
  '',
  'Every action is also a plain endpoint: `POST /api/actions/<name>`.',
].join('\n')

/**
 * The thing clients get wrong about this app, stated where they will read it.
 * Kept here rather than in the MCP `instructions` string because that string is
 * cached by clients for the life of a connection and this one is not.
 */
const NOTE_FIRST = [
  'Visvine is NOTE-FIRST. Almost everything in a space is a markdown note at a deterministic path, and the',
  'note IS the thing — not a description of a record stored elsewhere. A connector is `connectors/<name>.md`.',
  'An agent is `agents/<name>.md` plus `agents/live/<name>.md`. A Tool is three notes under `tools/<name>/`.',
  'An entity is a typed node plus its note (`people/<slug>.md`). Links are never authored: a markdown link to',
  'an entity note, inside a shared note, IS the edge.',
  '',
  'So there are few `create_*` actions, and their absence does NOT mean the thing cannot be made — it usually',
  'means it is written with `edit_context` at the right path. Never tell someone something is impossible here',
  'because you could not find an action named for it.',
].join('\n')

function scopeNote(def: ActionDef, caller: ActionCaller): string {
  return caller.scopes.includes(def.scope) ? '' : ` _(needs the \`${def.scope}\` scope, which this connection was not granted)_`
}

async function catalogue(caller: ActionCaller): Promise<string> {
  const defs = allActions()
  const notes = await readActionNotes()
  const lines = ['## Every action', '']
  for (const def of defs) {
    const summary = notes.get(def.name)?.summary || def.summary
    lines.push(`- \`${def.name}\` — ${summary}${scopeNote(def, caller)}`)
  }
  return lines.join('\n')
}

function spaceBlock(space: PlanSpaceFacts | null): string {
  if (!space) {
    return [
      '## Which space',
      '',
      'No `space_id` was given, so this plan is generic. Run `list_spaces` and ask again with one, and the',
      "plan will know your role, the space's enabled features, and what it already has.",
    ].join('\n')
  }
  const off = Object.entries(space.features)
    .filter(([, on]) => !on)
    .map(([k]) => k)
  return [
    `## In ${space.name}`,
    '',
    `- Space id: \`${space.id}\``,
    `- You ${space.you_are_admin ? 'ARE' : 'are NOT'} an admin here`,
    off.length ? `- Switched off: ${off.join(', ')}` : '- Every feature is switched on',
    space.connectors.length ? `- Connectors: ${space.connectors.join(', ')}` : '- No connectors yet',
    space.agents.length ? `- Agents: ${space.agents.join(', ')}` : '- No agents yet',
  ].join('\n')
}

export interface PlanRequest {
  caller: ActionCaller
  request?: string
  spaceId?: string
}

/**
 * The plan. Ordered for a model to act on top to bottom: how this surface
 * works, the recipe that fits, where it is being asked to work, then everything
 * else that exists in case the recipe was the wrong read.
 */
export async function buildGuide(req: PlanRequest): Promise<string> {
  const [recipes, space, actions] = await Promise.all([
    readRecipeNotes(),
    spaceFactsFor(req.caller, req.spaceId),
    catalogue(req.caller),
  ])

  const out: string[] = ['# Visvine', '', HOW_IT_WORKS, '', NOTE_FIRST, '']

  if (req.request) {
    const trimmed = req.request.length > 300 ? `${req.request.slice(0, 300)}…` : req.request
    out.push('## What you asked for', '', `> ${trimmed}`, '')

    const matches = scoreCandidates(req.request, recipes)
    const confidence = confidenceOf(matches)
    const chosen = confidence === 'low' ? null : recipes.find((r) => r.id === matches[0]?.id) ?? null

    if (chosen) {
      // `chosen.when` is not repeated here: the note opens with it, and a
      // recipe note has to read correctly on its own anyway.
      out.push(`## Plan: ${chosen.title}`, '', `_Matched with ${confidence} confidence._`, '', chosen.body, '')
      // The note lists the refusals this recipe can produce for anybody. These
      // are the ones that will actually happen to THIS caller in THIS space —
      // computed live, because they depend on their role, the scopes their
      // token carries, and which features are switched on. Predicting them here
      // is what stops a client discovering them three calls in, after it has
      // already asked someone for a credential it cannot store.
      const blockers = recipeById(chosen.id)?.blockers?.({ space, scopes: req.caller.scopes }) ?? []
      if (blockers.length) {
        out.push('## What will refuse you, here', '')
        for (const b of blockers) out.push(`- ${b}`)
        out.push('')
      }
    } else {
      out.push(
        '## No recipe matched confidently',
        '',
        'Get oriented rather than guess: `list_spaces` for the space id, then `list_context`, whose `types`',
        'catalogue is the authoritative account of what this space has enabled and how each type is created.',
        'Then pick from the recipes below and ask again with a more specific request.',
        '',
      )
    }

    const others = recipes.filter((r) => r.id !== chosen?.id)
    if (others.length) {
      out.push('## Other recipes', '')
      for (const r of others) out.push(`- \`${r.id}\` — ${r.when}`)
      out.push('')
    }
  } else if (recipes.length) {
    out.push('## Recipes', '')
    out.push(
      'Ask again with `request` set to what the user actually said and the matching one comes back in full.',
      '',
    )
    for (const r of recipes) out.push(`- \`${r.id}\` — ${r.when}`)
    out.push('')
  }

  out.push(spaceBlock(space), '')
  out.push(actions, '')
  out.push(
    '---',
    '',
    'These steps are advice, not authorization — every one still runs through the same permission gates.',
    'A wrong plan costs a refusal, never an escape.',
  )
  return out.join('\n')
}

/**
 * One action's manual: its note's prose if it has been synced, and the
 * contract regenerated from the live schema either way. The contract is
 * rendered here rather than trusted from the note so that documentation is
 * correct even against notes that were never synced, or synced long ago.
 */
export async function buildActionDoc(name: string): Promise<string | null> {
  const def = actionByName(name)
  if (!def) return null
  const note = await readActionNote(name)

  const contract = renderContract({
    action: def.name,
    scope: def.scope,
    readOnly: def.annotations?.readOnlyHint === true,
    destructive: def.annotations?.destructiveHint === true,
    params: paramsOf(def.input),
  })

  // The note's own contract block is dropped: the one rendered above is
  // generated from the live schema, and two copies of it would be one too many.
  const prose = note ? proseOutsideContract(note.body) : ''

  return [
    `# ${def.name}`,
    '',
    note?.summary || def.summary,
    '',
    contract,
    '',
    prose.length > 0 ? prose : def.description,
  ].join('\n')
}
