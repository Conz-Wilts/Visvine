// The routing invariant for `plan_visvine_query` (lib/mcp/planner.ts).
//
// The bug this tool exists to fix was a real one, reported verbatim: a client
// asked to create a connector answered "I can't create the connector directly.
// The Visvine MCP surface only exposes list_connectors and run_connector.
// Connectors are admin configured in the Visvine app itself." Every sentence of
// that is wrong — a connector IS a note at connectors/<name>.md and edit_context
// writes it — but it was a fair reading of a surface made of list_/run_ verbs.
//
// So the tests that matter here are behavioural, not structural: the phrasings
// a person actually uses must land on the recipe that unblocks them, and the
// recipe must name the tool that does the work. A planner that routes
// confidently to the wrong recipe is worse than the surface it replaced.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/mcp-planner.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan, planFeatures, scoreRecipes, type PlanSpaceFacts } from '@/lib/mcp/planner'

const ALL_SCOPES = ['context:read', 'context:write', 'connectors:use', 'agents:run', 'tools:author', 'tools:install', 'secrets:write']

/**
 * A plan is an open record by design — each recipe contributes its own optional
 * keys (`contract`, `blockers`, …) — so the assertions below narrow per field
 * rather than typing the whole thing.
 */
type Plan = Record<string, unknown>
interface PlanStepish {
  n: number
  tool: string
  args: Record<string, unknown>
}

function plan(prompt: string, space: PlanSpaceFacts | null = null, scopes = ALL_SCOPES): Plan {
  return buildPlan({ prompt, space, scopes })
}

function adminSpace(over: Partial<PlanSpaceFacts> = {}): PlanSpaceFacts {
  return {
    id: 'community:blackbird-ventures',
    name: 'Blackbird Ventures',
    you_are_admin: true,
    features: planFeatures(null),
    connectors: [],
    agents: [],
    ...over,
  }
}

/** The tools a plan actually tells the client to call. */
function toolsOf(p: Plan): string[] {
  return (p.steps as Array<{ tool: string }>).map((s) => s.tool)
}

test('the reported failure routes to the connector recipe and names edit_context', () => {
  // The exact ask that produced "I can't create the connector directly".
  for (const prompt of [
    'create a connector for the Stripe API',
    'add a connector so agents can query our Postgres database',
    'set up a new connector for HubSpot',
    'can you build me a connector to hit the GitHub API',
    'I want to hook up our CRM api to this space',
  ]) {
    const p = plan(prompt, adminSpace())
    assert.equal(p.intent, 'create_connector', `"${prompt}" routed to ${p.intent}`)
    assert.equal(p.confidence, 'high', `"${prompt}" was only ${p.confidence} confidence`)
    assert.ok(toolsOf(p).includes('edit_context'), 'the plan must name the tool that actually creates it')
  }
})

test('the connector plan carries the literal note contract, not a description of one', () => {
  const p = plan('create a connector for stripe', adminSpace())
  const contract = String(p.contract)
  // The four things a write fails without.
  assert.match(contract, /connectors\/<name>\.md/)
  assert.match(contract, /^type: connector$/m)
  assert.match(contract, /hosts:/)
  assert.match(contract, /\{\{secret:STRIPE_KEY\}\}/)
  // The write step must be fully specified — path, scope and visibility are all
  // load-bearing, and the visibility default is the one that silently hides the
  // connector from every member.
  const write = (p.steps as PlanStepish[]).find((s) => s.tool === 'edit_context')
  assert.equal(write?.args.scope, 'shared')
  assert.equal(write?.args.path, 'connectors/<name>.md')
  assert.equal(write?.args.visibility, 'inherit')
  assert.ok(
    (p.must_know as string[]).some((m) => /private by default/i.test(m)),
    'the private-by-default trap must be called out',
  )
})

test('a non-admin is told up front that the connector write will be refused', () => {
  const p = plan('create a connector for stripe', adminSpace({ you_are_admin: false }))
  assert.equal(p.intent, 'create_connector')
  assert.ok(
    (p.blockers as string[]).some((b) => /admin/i.test(b)),
    'connectors/ is admin-only — the plan must predict that refusal rather than let it surprise the client',
  )
})

test('a space with no connectors says so on the run recipe instead of dead-ending', () => {
  const p = plan('run the stripe connector and get recent customers', adminSpace())
  assert.equal(p.intent, 'use_connector')
  assert.ok(
    (p.blockers as string[]).some((b) => /zero connectors/.test(b) && /create_connector/.test(b)),
    'an empty space must be pointed at the recipe that fills it',
  )
})

test('the agent recipe tells the truth: drafting yes, authoring no', () => {
  for (const prompt of [
    'create an agent that summarises the week every Monday',
    'set up an agent to watch our dealflow',
    'automate a weekly digest',
  ]) {
    const p = plan(prompt, adminSpace())
    assert.equal(p.intent, 'create_agent', `"${prompt}" routed to ${p.intent}`)
  }
  const p = plan('create an agent that posts a weekly digest', adminSpace())
  // The freeze is structural, so it is a blocker, not a footnote.
  assert.ok((p.blockers as string[]).some((b) => /frozen for AI/i.test(b)))
  // And the plan must NOT propose writing to agents/, which is the one write
  // guaranteed to be refused (lib/notes/contextService.ts lockedDenial).
  for (const step of p.steps as PlanStepish[]) {
    const path = String(step.args?.path ?? '')
    assert.ok(!/^agents\//.test(path), `step ${step.n} proposes a write to ${path}, which is always refused`)
  }
  assert.match(String(p.contract), /agents\/live\/<name>\.md/)
})

test('a missing scope is predicted at plan time, not discovered at step four', () => {
  const readOnly = ['context:read']
  const p = plan('run the stripe connector', adminSpace({ connectors: ['stripe'] }), readOnly)
  assert.ok((p.blockers as string[]).some((b) => b.includes("'connectors:use'")))

  const write = plan('create a connector for stripe', adminSpace(), readOnly)
  assert.ok((write.blockers as string[]).some((b) => b.includes("'context:write'")))
  // The credential step is called out separately: a read-only token can be told
  // it cannot finish the job BEFORE the user hands over a key it can't store.
  assert.ok((write.blockers as string[]).some((b) => b.includes("'secrets:write'")))
})

test('the connector build plans the credential step between writing the note and testing it', () => {
  const p = plan('add an api as a connector to our company context', adminSpace(), ALL_SCOPES)
  const steps = p.steps as PlanStepish[]
  const tools = steps.map((s) => String(s.tool))
  const secretAt = tools.indexOf('set_connector_secret')
  assert.ok(secretAt > tools.indexOf('edit_context'), 'the secret is stored after the note declares it')
  assert.ok(secretAt < tools.indexOf('run_connector'), 'and before the run that would otherwise fail missing_secret')
  // The one instruction that must survive any rewrite of this recipe.
  assert.ok(
    (p.must_know as string[]).some((m) => /NEVER write a credential value into the note/.test(m)),
    'the value goes in the store, never in the note',
  )
})

test('a switched-off feature is a blocker, not a mystery', () => {
  const off = adminSpace({ features: { ...planFeatures(null), connectors: false } })
  const p = plan('create a connector for stripe', off)
  assert.ok((p.blockers as string[]).some((b) => /'connectors' feature is switched off/.test(b)))
})

test('the everyday recipes route to the tools that do the work', () => {
  const cases: Array<[string, string, string]> = [
    ['add Craig Piggott as a person in the directory', 'create_entity', 'add_context'],
    ['what do we know about Halter', 'find_context', 'search_context'],
    ['build a dashboard tool for our pipeline', 'build_tool', 'create_tool'],
    ['trigger the weekly-digest agent now', 'run_agent', 'run_agent'],
    ['clean up the broken links in this space', 'organise_context', 'clean_context'],
    ['who can see the deals folder', 'manage_access', 'list_context'],
  ]
  for (const [prompt, intent, tool] of cases) {
    const p = plan(prompt, adminSpace())
    assert.equal(p.intent, intent, `"${prompt}" routed to ${p.intent}`)
    assert.ok(toolsOf(p).includes(tool), `"${prompt}" never names ${tool}`)
  }
})

test('a prompt nothing matches orients instead of guessing', () => {
  const p = plan('hello there', adminSpace())
  assert.equal(p.intent, 'orient')
  assert.equal(p.confidence, 'low')
  assert.deepEqual(toolsOf(p).slice(0, 2), ['list_spaces', 'list_context'])
  // The fallback still has to carry the one fact that unblocks a stuck client.
  assert.ok((p.must_know as string[]).some((m) => /note-first/i.test(m)))
})

test('every plan offers the way out of a misread intent', () => {
  const p = plan('create a connector for stripe', adminSpace())
  const others = p.other_intents as Array<{ intent: string; when: string }>
  assert.ok(others.length >= 8, 'the full catalog is the escape hatch')
  assert.ok(!others.some((o) => o.intent === 'create_connector'), 'the chosen intent is not repeated')
  assert.ok(others.every((o) => o.when.length > 0), 'every alternative says when it applies')
  assert.match(String(p.if_this_is_wrong), /plan_visvine_query again/)
})

test('no space_id yields a generic plan that says how to get a better one', () => {
  const p = plan('create a connector for stripe', null)
  assert.equal(p.space, null)
  assert.match(String(p.space_note), /list_spaces/)
  // Steps still resolve to something callable — a placeholder, clearly marked.
  const write = (p.steps as PlanStepish[]).find((s) => s.tool === 'edit_context')
  assert.match(String(write?.args.space_id), /^<space_id/)
})

test('every recipe scores its own trigger phrase above everything else', () => {
  // Guards against a new recipe stealing an existing one's phrasing: the
  // catalog is ordered by score, so an over-broad pattern is invisible until
  // something it should not match lands on it.
  const anchors: Array<[string, string]> = [
    ['create a connector', 'create_connector'],
    ['create an agent', 'create_agent'],
    ['build a tool', 'build_tool'],
    ['add a person to the directory', 'create_entity'],
  ]
  for (const [prompt, expected] of anchors) {
    const [top] = scoreRecipes(prompt)
    assert.equal(top?.recipe.id, expected, `"${prompt}" topped out at ${top?.recipe.id}`)
  }
})
