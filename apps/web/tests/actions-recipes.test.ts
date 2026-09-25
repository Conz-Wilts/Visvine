// The routing invariant for the Visvine gateway's PLAN mode.
//
// The bug this machinery exists to fix was a real one, reported verbatim: a
// client asked to create a connector answered "I can't create the connector
// directly. The Visvine MCP surface only exposes list_connectors and
// run_connector. Connectors are admin configured in the Visvine app itself."
// Every sentence of that is wrong — a connector IS a note at
// connectors/<name>.md and edit_context writes it — but it was a fair reading
// of a surface made of list_/run_ verbs.
//
// So the tests that matter here are behavioural, not structural: the phrasings
// a person actually uses must land on the recipe that unblocks them, and the
// recipe must name the action that does the work. A plan that routes
// confidently to the wrong recipe is worse than the surface it replaced.
//
// These run against the SHIPPED catalogue (lib/actions/recipes.ts), which is
// what `db:actions:sync` renders into the notes — so a regression here is a
// regression in what every deployment will say.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/actions-recipes.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allRecipes,
  orientRecipe,
  planFeatures,
  recipeById,
  renderRecipeBody,
  type PlanSpaceFacts,
  type RecipeContext,
} from '@/lib/actions/recipes'
import { confidenceOf, scoreCandidates } from '@/lib/actions/shared/match'
import { actionByName } from '@/lib/actions/registry'

const ALL_SCOPES = [
  'context:read',
  'context:write',
  'connectors:use',
  'agents:run',
  'tools:author',
  'tools:install',
  'tools:list',
  'secrets:write',
]

function adminSpace(over: Partial<PlanSpaceFacts> = {}): PlanSpaceFacts {
  return {
    id: 'space:blackbird-ventures',
    name: 'Blackbird Ventures',
    you_are_admin: true,
    features: planFeatures(null),
    connectors: [],
    agents: [],
    ...over,
  }
}

/** What the gateway does: score the catalogue, take the winner above `low`. */
function route(prompt: string): { intent: string; confidence: string } {
  const matches = scoreCandidates(prompt, allRecipes())
  const confidence = confidenceOf(matches)
  return { intent: confidence === 'low' ? orientRecipe().id : matches[0].id, confidence }
}

function ctx(space: PlanSpaceFacts | null, scopes: readonly string[] = ALL_SCOPES): RecipeContext {
  return { space, scopes }
}

function blockers(id: string, space: PlanSpaceFacts | null, scopes: readonly string[] = ALL_SCOPES): string[] {
  return recipeById(id)?.blockers?.(ctx(space, scopes)) ?? []
}

/** The actions a recipe tells the client to call, in order. */
function stepsOf(id: string): string[] {
  const recipe = recipeById(id)
  assert.ok(recipe, `no recipe ${id}`)
  return recipe.steps(ctx(adminSpace())).map((s) => s.tool)
}

test('the reported failure routes to the connector recipe and names edit_context', () => {
  for (const prompt of [
    'create a connector for the Stripe API',
    'add a connector so agents can query our Postgres database',
    'set up a new connector for HubSpot',
    'can you build me a connector to hit the GitHub API',
    'I want to hook up our CRM api to this space',
  ]) {
    const { intent, confidence } = route(prompt)
    assert.equal(intent, 'create_connector', `"${prompt}" routed to ${intent}`)
    assert.equal(confidence, 'high', `"${prompt}" was only ${confidence} confidence`)
  }
  assert.ok(
    stepsOf('create_connector').includes('edit_context'),
    'the plan must name the action that actually creates it',
  )
})

test('the connector recipe carries the literal note contract, not a description of one', () => {
  const recipe = recipeById('create_connector')!
  const contract = String(recipe.contract)
  // The four things a write fails without.
  assert.match(contract, /connectors\/<name>\.md/)
  assert.match(contract, /^type: connector$/m)
  assert.match(contract, /hosts:/)
  assert.match(contract, /\{\{secret:STRIPE_KEY\}\}/)
  // The write step must be fully specified — path and visibility are both
  // load-bearing, and the visibility default is the one that silently hides the
  // connector from every member.
  const write = recipe.steps(ctx(adminSpace())).find((s) => s.tool === 'edit_context')
  assert.equal(write?.args.path, 'connectors/<name>.md')
  assert.equal(write?.args.visibility, 'inherit')
  assert.ok(
    recipe.mustKnow(ctx(adminSpace())).some((m) => /private by default/i.test(m)),
    'the private-by-default trap must be called out',
  )
})

test('a non-admin is told up front that the connector write will be refused', () => {
  assert.ok(
    blockers('create_connector', adminSpace({ you_are_admin: false })).some((b) => /admin/i.test(b)),
    'connectors/ is admin-only — the plan must predict that refusal rather than let it surprise the client',
  )
})

test('a space with no connectors says so on the run recipe instead of dead-ending', () => {
  assert.equal(route('run the stripe connector and get recent customers').intent, 'use_connector')
  assert.ok(
    blockers('use_connector', adminSpace()).some(
      (b) => /zero connectors/.test(b) && /create_connector/.test(b),
    ),
    'an empty space must be pointed at the recipe that fills it',
  )
})

test('the agent recipe creates and then hands the switch to an admin', () => {
  for (const prompt of [
    'create an agent that summarises the week every Monday',
    'set up an agent to watch our dealflow',
    'automate a weekly digest',
  ]) {
    assert.equal(route(prompt).intent, 'create_agent', `"${prompt}" routed elsewhere`)
  }
  const recipe = recipeById('create_agent')!
  const steps = recipe.steps(ctx(adminSpace()))

  // Authoring is no longer a hand-off: the plan must actually create the agent.
  assert.ok(steps.some((s) => s.tool === 'create_agent'), 'the plan must call create_agent')
  assert.ok(steps.some((s) => s.tool === 'activate_agent'), 'the plan must say how it gets turned on')

  // The one thing that is still always refused: a generic context write into
  // agents/. Briefs are written by the dedicated action or by a person, never
  // by edit_context (lib/notes/contextService.ts lockedDenial).
  for (const step of steps) {
    const path = String(step.args?.path ?? '')
    assert.ok(!/^agents\//.test(path), `step ${step.n} proposes a write to ${path}, which is always refused`)
    assert.ok(!/^drafts\//.test(path), `step ${step.n} parks a draft at ${path} instead of creating the agent`)
  }

  // Creating is not starting, and the recipe must say so where a caller reads
  // it — that is the mistake this whole shape exists to prevent.
  assert.match(String(recipe.contract), /does NOT start it/i)
  assert.ok(
    recipe.mustKnow!(ctx(adminSpace())).some((m) => /CREATING IS NOT STARTING/.test(m)),
    'the plan must warn that a new agent is inert',
  )
})

test('a missing scope is predicted at plan time, not discovered at step four', () => {
  const readOnly = ['context:read']
  assert.ok(
    blockers('use_connector', adminSpace({ connectors: ['stripe'] }), readOnly).some((b) =>
      b.includes("'connectors:use'"),
    ),
  )
  const write = blockers('create_connector', adminSpace(), readOnly)
  assert.ok(write.some((b) => b.includes("'context:write'")))
  // The credential step is called out separately: a read-only token can be told
  // it cannot finish the job BEFORE the user hands over a key it can't store.
  assert.ok(write.some((b) => b.includes("'secrets:write'")))
})

test('the connector build plans the credential step between writing the note and testing it', () => {
  const tools = stepsOf('create_connector')
  const secretAt = tools.indexOf('set_connector_secret')
  assert.ok(secretAt > tools.indexOf('edit_context'), 'the secret is stored after the note declares it')
  assert.ok(secretAt < tools.indexOf('run_connector'), 'and before the run that would otherwise fail missing_secret')
  // The one instruction that must survive any rewrite of this recipe.
  assert.ok(
    recipeById('create_connector')!
      .mustKnow(ctx(adminSpace()))
      .some((m) => /NEVER write a credential value into the note/.test(m)),
    'the value goes in the store, never in the note',
  )
})

test('a switched-off feature is a blocker, not a mystery', () => {
  const off = adminSpace({ features: { ...planFeatures(null), connectors: false } })
  assert.ok(blockers('create_connector', off).some((b) => /'connectors' feature is switched off/.test(b)))
})

test('the everyday recipes route to the actions that do the work', () => {
  const cases: Array<[string, string, string]> = [
    ['add Craig Piggott as a person in the directory', 'create_entity', 'add_context'],
    ['what do we know about Halter', 'find_context', 'search_context'],
    ['build a dashboard tool for our pipeline', 'build_tool', 'create_tool'],
    ['trigger the weekly-digest agent now', 'run_agent', 'run_agent'],
    ['clean up the broken links in this space', 'organise_context', 'clean_context'],
    ['who can see the deals folder', 'manage_access', 'list_context'],
    ['create an event for our launch night in October', 'run_event', 'create_event'],
    ['set up a meetup from the plan in the drive', 'run_event', 'list_resources'],
    ['create a new space called Test Space, and a sub-space inside it called Test Sub', 'create_space', 'create_space'],
    ['make a subspace for the leadership team', 'create_space', 'create_space'],
  ]
  for (const [prompt, intent, tool] of cases) {
    const routed = route(prompt).intent
    assert.equal(routed, intent, `"${prompt}" routed to ${routed}`)
    assert.ok(stepsOf(intent).includes(tool), `"${prompt}" never names ${tool}`)
  }
})

test('the event recipe starts at the Drive, and never publishes by accident', () => {
  assert.equal(route('create an event from the flyer and run sheet we uploaded').intent, 'run_event')
  const recipe = recipeById('run_event')!
  const steps = recipe.steps(ctx(adminSpace()))
  // The material comes first: an event built without reading the plan is the
  // whole failure this recipe exists to prevent.
  assert.equal(steps[0].tool, 'list_resources')
  const create = steps.find((s) => s.tool === 'create_event')
  assert.ok(create, 'the plan must name the action that creates the event')
  assert.ok('cover_resource_id' in create.args, 'the poster is part of the create call')
  // Publishing is a separate, optional step — a draft is the default.
  assert.equal(steps.find((s) => s.tool === 'update_event')?.optional, true)
  assert.ok(
    recipe.mustKnow(ctx(adminSpace())).some((m) => /draft/i.test(m) && /publish/i.test(m)),
    'the draft/publish distinction must be stated, not discovered',
  )
  // The marketing copy belongs in the event's own folder.
  const copy = steps.find((s) => s.tool === 'edit_context')
  assert.match(String(copy?.args.path), /^events\/<slug>\//)
})

test('a prompt nothing matches orients instead of guessing', () => {
  const { intent, confidence } = route('hello there')
  assert.equal(intent, 'orient')
  assert.equal(confidence, 'low')
  const steps = orientRecipe()
    .steps(ctx(adminSpace()))
    .map((s) => s.tool)
  assert.deepEqual(steps.slice(0, 2), ['list_spaces', 'list_context'])
  // The fallback still has to carry the one fact that unblocks a stuck client.
  assert.ok(orientRecipe().mustKnow(ctx(adminSpace())).some((m) => /note-first/i.test(m)))
})

test('every recipe scores its own trigger phrase above everything else', () => {
  // Guards against a new recipe stealing an existing one's phrasing: the
  // catalogue is ordered by score, so an over-broad rule is invisible until
  // something it should not match lands on it.
  const anchors: Array<[string, string]> = [
    ['create a connector', 'create_connector'],
    ['create an agent', 'create_agent'],
    ['build a tool', 'build_tool'],
    ['add a person to the directory', 'create_entity'],
    ['create a space', 'create_space'],
  ]
  for (const [prompt, expected] of anchors) {
    const [top] = scoreCandidates(prompt, allRecipes())
    assert.equal(top?.id, expected, `"${prompt}" topped out at ${top?.id}`)
  }
})

test('every action a recipe names actually exists', () => {
  // A recipe is content, and content goes stale. This is the check that stops
  // the notes advertising a call that 404s: every step either names a real
  // action or is an explicit hand-off to a person.
  for (const recipe of [...allRecipes(), orientRecipe()]) {
    for (const step of recipe.steps(ctx(adminSpace()))) {
      if (step.tool.startsWith('(')) continue
      assert.ok(actionByName(step.tool), `${recipe.id} step ${step.n} names '${step.tool}', which does not exist`)
    }
  }
})

test('a rendered recipe note carries the steps, the traps and the contract', () => {
  // This is what `db:actions:sync` writes and what the gateway reads back, so
  // anything lost in rendering is lost to every agent.
  const body = renderRecipeBody(recipeById('create_connector')!)
  assert.match(body, /## Steps/)
  assert.match(body, /edit_context/)
  assert.match(body, /## What decides whether this works/)
  assert.match(body, /NEVER write a credential value into the note/)
  assert.match(body, /## The contract/)
  assert.match(body, /connectors\/<name>\.md/)
})

test('a space and a directory record are never confused', () => {
  // "space" is both a tenant and an organisation's card. Starting one routes to
  // create_space; recording a company still routes to add_context, and each
  // recipe says the other exists.
  assert.equal(route('record Canva as a company in the directory').intent, 'create_entity')
  assert.equal(route('set up a workspace for the design partners').intent, 'create_space')
  assert.ok(recipeById('create_entity')!.mustKnow(ctx(adminSpace())).some((m) => /create_space/.test(m)))
  assert.match(recipeById('create_space')!.summary, /add_context/)
  // A non-admin is told up front that a sub-space under this space will be refused.
  const member = adminSpace({ you_are_admin: false })
  assert.ok(blockers('create_space', member).some((b) => /not an admin/.test(b)))
  assert.deepEqual(blockers('create_space', adminSpace()), [])
})
