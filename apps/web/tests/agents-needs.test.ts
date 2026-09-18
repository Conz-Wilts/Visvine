// What an agent needs before it can do its job — the pure judgement behind
// create_agent's and rehearse_agent's `needs` and `plan`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { agentNeeds, hardNeeds, type NeedsCatalogEntry } from '@/lib/agents/shared/needs'
import { needsCatalog } from '@/lib/agents/needs'

const catalog: NeedsCatalogEntry[] = [
  { id: 'slack', name: 'Slack', connects: 'key', perMember: false },
  { id: 'gmail', name: 'Gmail', connects: 'one-click', perMember: true },
  { id: 'notion', name: 'Notion', connects: 'sign-in', perMember: true },
  { id: 'notion-mcp', name: 'Notion', connects: 'sign-in', perMember: true },
  { id: 'mcp', name: 'MCP server', connects: 'sign-in', perMember: true },
]

test('a brief with everything it needs is ready, and the plan is rehearse then activate', () => {
  const r = agentNeeds({
    declared: [{ connector: 'slack', status: 'ok' }],
    instructions: 'Every Monday, summarise the week and post it to Slack.',
    modelProblem: null,
    catalog,
    spaceConnectors: [{ name: 'slack', recipe: 'slack' }],
  })
  assert.equal(r.ready, true)
  assert.deepEqual(r.needs, [])
  assert.equal(r.plan.length, 2)
  assert.match(r.plan[0], /rehearse_agent/)
  assert.match(r.plan[1], /activate_agent/)
})

test('a declared connector the space does not have is a need, with the catalogue way in', () => {
  const r = agentNeeds({
    declared: [{ connector: 'slack', status: 'missing' }],
    instructions: 'Post to Slack.',
    modelProblem: null,
    catalog,
    spaceConnectors: [],
  })
  assert.equal(r.ready, false)
  assert.equal(r.needs.length, 1)
  const [n] = r.needs
  assert.equal(n.status, 'missing')
  assert.equal(n.need, 'slack')
  assert.match(n.fix, /Add Slack from the catalogue/)
  assert.match(n.fix, /API key/)
  assert.equal(n.who, 'admin')
  assert.equal(n.href, '/admin?section=connectors')
  // Declared AND mentioned is one need, not two.
  assert.match(r.plan[0], /^1\. Add Slack/)
  assert.match(r.plan[0], /\(a space admin\)$/)
})

test('a declared connector nobody has signed in to is the member\'s to fix, at the sign-in link', () => {
  const r = agentNeeds({
    declared: [{ connector: 'gmail', status: 'needs_connection', connectUrl: 'https://x/connect' }],
    instructions: 'Read my inbox.',
    modelProblem: null,
    catalog,
    spaceConnectors: [{ name: 'gmail', recipe: 'gmail' }],
  })
  const [n] = r.needs
  assert.equal(n.status, 'needs_connection')
  assert.equal(n.who, 'member')
  assert.equal(n.href, 'https://x/connect')
  assert.match(n.fix, /Sign in: https:\/\/x\/connect/)
})

test('a service the instructions name but the brief never declared is caught', () => {
  // The space HAS a Slack connector — the brief just forgot to list it.
  const held = agentNeeds({
    declared: [],
    instructions: 'Each morning, post the digest to Slack.',
    modelProblem: null,
    catalog,
    spaceConnectors: [{ name: 'slack-2', recipe: 'slack' }],
  })
  assert.equal(held.needs.length, 1)
  assert.equal(held.needs[0].status, 'undeclared')
  assert.equal(held.needs[0].need, 'slack-2')
  assert.match(held.needs[0].fix, /Add `slack-2` to the brief's `connectors:`/)

  // The space has NOTHING for it — someone has to add one first.
  const none = agentNeeds({
    declared: [],
    instructions: 'Each morning, post the digest to slack.',
    modelProblem: null,
    catalog,
    spaceConnectors: [],
  })
  assert.equal(none.needs[0].status, 'not_in_space')
  assert.equal(none.needs[0].need, 'slack')
  assert.match(none.needs[0].fix, /Then add it to the brief's `connectors:`/)
})

test('a declared connector covers its service under any name, and one name covers every recipe', () => {
  // Declared as `slack-2`, written from the slack recipe: the mention is covered.
  const r = agentNeeds({
    declared: [{ connector: 'slack-2', status: 'ok' }],
    instructions: 'Post to Slack.',
    modelProblem: null,
    catalog,
    spaceConnectors: [{ name: 'slack-2', recipe: 'slack' }],
  })
  assert.deepEqual(r.needs, [])

  // "Notion" is two recipes; a connector to either satisfies a mention.
  const mcp = agentNeeds({
    declared: [{ connector: 'notion-mcp', status: 'ok' }],
    instructions: 'Read the Notion roadmap.',
    modelProblem: null,
    catalog,
    spaceConnectors: [{ name: 'notion-mcp', recipe: 'notion-mcp' }],
  })
  assert.deepEqual(mcp.needs, [])
})

test('mentions are whole words, and generic catalogue names never count', () => {
  const r = agentNeeds({
    declared: [],
    instructions: 'Use the MCP server. Slackers need not apply. Read gmail.',
    modelProblem: null,
    catalog,
    spaceConnectors: [],
  })
  assert.deepEqual(
    r.needs.map((n) => n.need),
    ['gmail'],
  )
})

test('no model comes first, and the plan counts every step', () => {
  const r = agentNeeds({
    declared: [{ connector: 'slack', status: 'disabled' }],
    instructions: 'Post to Slack.',
    modelProblem: 'This space has no model yet.',
    catalog,
    spaceConnectors: [{ name: 'slack', recipe: 'slack' }],
  })
  assert.deepEqual(
    r.needs.map((n) => n.status),
    ['no_model', 'disabled'],
  )
  assert.equal(r.plan.length, 4)
  assert.match(r.plan[0], /^1\. Add a model/)
  assert.match(r.plan[1], /^2\. Turn it back on/)
  assert.match(r.plan[2], /^3\. Rehearse/)
  assert.match(r.plan[3], /^4\. Turn it on/)
})

test('the real catalogue narrows to what the wording needs', () => {
  const rows = needsCatalog([])
  assert.ok(rows.length > 40)
  const slack = rows.find((r) => r.id === 'slack')!
  assert.equal(slack.connects, 'key')
  const gmail = rows.find((r) => r.id === 'gmail')!
  // No platform client on this deployment: a sign-in, not one click.
  assert.equal(gmail.connects, 'sign-in')
  assert.equal(gmail.perMember, true)
  assert.equal(needsCatalog(['google']).find((r) => r.id === 'gmail')!.connects, 'one-click')
})

test('only a need no runner can get past is hard — the switch refuses those and warns about the rest', () => {
  const r = agentNeeds({
    declared: [
      { connector: 'slack', status: 'missing' },
      { connector: 'hubspot', status: 'disabled' },
      { connector: 'gmail', status: 'needs_connection', connectUrl: 'https://x' },
    ],
    instructions: 'Read Notion, post to Slack.',
    modelProblem: null,
    catalog,
    spaceConnectors: [{ name: 'hubspot', recipe: 'hubspot' }, { name: 'gmail', recipe: 'gmail' }],
  })
  assert.deepEqual(
    hardNeeds(r).map((n) => n.need),
    ['slack', 'hubspot'],
  )
  // A sign-in is the runner's to do; a service read out of the prose is a reading.
  assert.deepEqual(
    r.needs.filter((n) => !hardNeeds(r).includes(n)).map((n) => n.status),
    ['needs_connection', 'not_in_space'],
  )
})

test('an implied service is a soft need, worded as a reading — and not when the space already has one of its kind', () => {
  const catalog = [
    { id: 'slack', name: 'Slack', category: 'messengers', connects: 'key' as const, perMember: false },
    { id: 'discord', name: 'Discord', category: 'messengers', connects: 'key' as const, perMember: false },
  ]
  const base = { declared: [], instructions: 'Post the summary to the team channel.', modelProblem: null, catalog }
  const implied = agentNeeds({ ...base, spaceConnectors: [], implied: ['slack'] })
  assert.equal(implied.needs.length, 1)
  assert.equal(implied.needs[0].status, 'not_in_space')
  assert.match(implied.needs[0].why, /read as needing Slack, without naming it/)
  assert.deepEqual(hardNeeds(implied), [])
  const hasDiscord = agentNeeds({ ...base, spaceConnectors: [{ name: 'discord', recipe: 'discord' }], implied: ['slack'] })
  assert.deepEqual(hasDiscord.needs, [])
})
