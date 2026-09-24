/**
 * The agent tool surface (lib/agents/tools.ts) against fakes — which tools a
 * brief is offered, the run_agent depth guard, dry-run capture and the write
 * collector. No DB, no model: the
 * handlers are called directly (and once through the shared loop with a
 * scripted model, as the runner does).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-tools.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageCommand, PageResult, PageState } from '@/lib/vm/shared/pageScript'
import { agentTools, MAX_CHAIN_DEPTH, type AgentToolContext, type AgentToolDeps } from '@/lib/agents/tools'
import type { AgentBrief } from '@/lib/agents/config'
import { parseModelRef } from '@/lib/agents/registry'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import { runToolLoop, type ChatFn, type ToolLoopEvent } from '@/lib/notes/toolLoop'
import type { ChatWithToolsResult } from '@/lib/notes/ai'

const SPACE = 'space-1'

function brief(over: Partial<AgentBrief> = {}): AgentBrief {
  return {
    title: 'Weekly digest',
    description: null,
    tags: [],
    model: 'gemini/x',
    modelRef: (() => {
      const r = parseModelRef('gemini/x')
      if (!r.ok) throw new Error(r.error)
      return r.ref
    })(),
    connectors: [],
    tools: [],
    agents: [],
    share: 'none',
    shareAs: 'use',
    runsFor: [],
    dryRun: false,
    maxTurns: 8,
    body: 'do the thing',
    ...over,
  }
}

interface Fakes {
  deps: AgentToolDeps
  claims: { name: string; startedBy: string; chain: { parent: string; depth: number } }[]
  writes: { path: string; content: string }[]
  appends: { path: string; text: string }[]
  created: { type: string; name: string; stamp?: { origin?: string; model?: string } }[]
  links: { from: string; to: string; relationship: string }[]
  commands: { cmd: string[]; runId: string | null; taskAllow: string[] | undefined }[]
  pages: { url: string; taskAllow: string[] | undefined }[]
  signIns: { connector: string; taskAllow: string[] | undefined }[]
  pageCommands: { command: PageCommand; runId: string | null | undefined; taskAllow: string[] | undefined }[]
  browsed: { goal: string; inputs: Record<string, string> }[]
  judged: { items: number; questions: string[] }[]
  /** What the next page command answers; a snapshot of PAGE by default. */
  nextPage: PageResult | null
}

function fakes(): Fakes {
  const f: Fakes = {
    claims: [],
    writes: [],
    appends: [],
    created: [],
    links: [],
    commands: [],
    pages: [],
    signIns: [],
    pageCommands: [],
    browsed: [],
    judged: [],
    nextPage: null,
    deps: {
      writeGated: (async (_p, _c, path: string, content: string) => {
        f.writes.push({ path, content })
        return { status: 'applied', path }
      }) as AgentToolDeps['writeGated'],
      appendLogGated: (async (_p, _c, path: string, text: string) => {
        f.appends.push({ path, text })
        return { status: 'applied', path }
      }) as AgentToolDeps['appendLogGated'],
      claimManualRun: async (space, name, startedBy, opts) => {
        f.claims.push({ name, startedBy, chain: opts.chain, ...(space !== SPACE ? { space } : {}), ...(opts.runAs ? { runAs: opts.runAs } : {}) })
        return { ok: true, runId: `run-${name}`, dispatch: Promise.resolve() }
      },
      // Every name is an agent of the space unless a test says otherwise.
      findAgentState: async () => true,
      sharedParentAgent: async () => null,
      createEntity: (async (_ctx: unknown, input: { type: string; name: string; stamp?: { origin?: string; model?: string } }) => {
        f.created.push({ type: input.type, name: input.name, stamp: input.stamp })
        return { ok: true, node: { id: `${input.type}:${input.name}` }, notePath: `people/${input.name}.md`, resolution: null, noteError: null }
      }) as unknown as AgentToolDeps['createEntity'],
      linkNodes: async ({ from, to, relationship }) => {
        f.links.push({ from, to, relationship })
        return null
      },
      machineAvailable: () => true,
      runOnMachine: (async (_space: string, _agent: string, cmd: readonly string[], opts?: { runId?: string | null; taskAllow?: readonly string[] }) => {
        f.commands.push({ cmd: [...cmd], runId: opts?.runId ?? null, taskAllow: opts?.taskAllow ? [...opts.taskAllow] : undefined })
        return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, vmId: 'vm-1', booted: true }
      }) as AgentToolDeps['runOnMachine'],
      browseOnMachine: (async (_space: string, _agent: string, url: string, opts?: { taskAllow?: readonly string[] }) => {
        f.pages.push({ url, taskAllow: opts?.taskAllow ? [...opts.taskAllow] : undefined })
        return { started: true, alreadyRunning: false, vmId: 'vm-1' }
      }) as AgentToolDeps['browseOnMachine'],
      signInOnMachine: (async (input: { connectorName: string; taskAllow?: readonly string[] }) => {
        f.signIns.push({ connector: input.connectorName, taskAllow: input.taskAllow ? [...input.taskAllow] : undefined })
        return input.connectorName === 'crm-login'
          ? { ok: true, url: 'https://crm.example.com/home', title: 'Home', user: 'ops@acme.com' }
          : { ok: false, reason: 'no_login', message: `${input.connectorName} holds no website login` }
      }) as AgentToolDeps['signInOnMachine'],
      pageOnMachine: async (_space, _agent, command, opts) => {
        f.pageCommands.push({ command, runId: opts?.runId, taskAllow: opts?.taskAllow ? [...opts.taskAllow] : undefined })
        const answer = f.nextPage ?? { ok: true as const, acted: !!command.act, state: PAGE }
        f.nextPage = null
        return answer
      },
      browseTaskOnMachine: async (_space, _agent, input) => {
        f.browsed.push({ goal: input.goal, inputs: { ...input.inputs } })
        return {
          status: 'done',
          steps: [{ operation: 'TYPE_TEXT', label: 'City', text: 'Lisbon', page_changed: true }, { operation: 'CLICK', label: 'Search', page_changed: true }],
          page: PAGE,
          judgeCalls: 3,
          elapsedMs: 2_400,
        }
      },
      // Off unless a test asks: the base surface is what a deployment with no judge offers.
      judgeAvailable: () => false,
      decideMany: async (requests) => {
        f.judged.push({ items: requests.length, questions: Object.keys(requests[0]?.questions ?? {}) })
        return requests.map((r, i) =>
          i === 1
            ? null
            : {
                urgent: { type: 'noul' as const, noul: String(r.state).includes('NOW') ? 0.93 : 0.04 },
                kind: { type: 'choice' as const, choice: 'invoice', probabilities: { invoice: 0.8, other: 0.2 }, confidence: 0.77 },
              },
        )
      },
      takeSpaceJudgeAllowance: async () => ({ ok: true, retryAfterMs: 0 }),
    },
  }
  return f
}

function ctx(f: Fakes, over: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    principal: { userId: 'author-1', email: 'a@x', name: 'Author', spaceId: SPACE, spaceAdmin: false, access: OPEN_ACCESS },
    context: { spaceId: SPACE, ownerKey: 'shared' },
    spaceId: SPACE,
    agentName: 'weekly-digest',
    brief: brief(),
    runId: 'run-root',
    deps: f.deps,
    ...over,
  }
}

const tool = (tools: ReturnType<typeof agentTools>, name: string) => {
  const t = tools.find((x) => x.spec.name === name)
  assert.ok(t, `tool ${name} offered`)
  return t
}
const names = (tools: ReturnType<typeof agentTools>) => tools.map((t) => t.spec.name)

test('the surface: always-on tools, and extras only when the brief asks', () => {
  const f = fakes()
  // Notes, people and the roster are every agent's; the machine comes with the
  // space (the fakes say it has one). The rest is what the brief asked for.
  const base = names(agentTools(ctx(f)))
  assert.deepEqual(base, [
    'list_context',
    'search_context',
    'read_context',
    'write_context',
    'append_context',
    'remember',
    'run_command',
    'open_page',
    'page_snapshot',
    'page_act',
    'run_agent',
  ])
  const judged = names(agentTools(ctx(f, { deps: { ...f.deps, judgeAvailable: () => true } })))
  assert.ok(judged.includes('decide') && judged.includes('browse_task'), 'a judge adds decide and browse_task')
  assert.ok(!base.includes('decide') && !base.includes('browse_task'), 'and without one neither is offered')
  const full = names(
    agentTools(ctx(f, { brief: brief({ tools: ['web', 'directory', 'actions'], agents: ['other'], connectors: ['hubspot'] }) })),
  )
  for (const n of ['run_connector', 'sign_in', 'fetch_url', 'run_action', 'create_node', 'link_nodes']) assert.ok(full.includes(n), n)
  assert.ok(!base.includes('create_node') && !base.includes('run_action') && !base.includes('fetch_url'), 'no directory / actions / web without opt-in')
  assert.ok(!base.includes('sign_in'), 'no sign_in without a declared connector')
})

test('the machine reaches what the brief declares: machineAllow rides every lease, and absent means none', async () => {
  const f = fakes()
  const reach = ['api.hubspot.com', 'crm.example.com']
  const tools = agentTools(ctx(f, { brief: brief({ connectors: ['hubspot', 'crm-login'] }), machineAllow: reach }))
  assert.match(tool(tools, 'run_command').spec.description, /api\.hubspot\.com, crm\.example\.com/, 'the description says what is reachable')
  await tool(tools, 'run_command').run({ command: ['ls'] })
  await tool(tools, 'open_page').run({ url: 'https://crm.example.com/' })
  await tool(tools, 'sign_in').run({ connector: 'crm-login' })
  assert.deepEqual(f.commands.map((c) => c.taskAllow), [reach])
  assert.deepEqual(f.pages.map((p) => p.taskAllow), [reach])
  assert.deepEqual(f.signIns.map((s) => s.taskAllow), [reach])

  const none = agentTools(ctx(f))
  assert.match(tool(none, 'run_command').spec.description, /declares no connectors, so nothing is reachable/)
  await tool(none, 'run_command').run({ command: ['ls'] })
  assert.deepEqual(f.commands.at(-1)?.taskAllow, [], 'no declaration is an empty list, never the space\'s whole reach')
})

test('sign_in: only a declared connector, and the answer never carries a password', async () => {
  const f = fakes()
  const t = tool(agentTools(ctx(f, { brief: brief({ connectors: ['crm-login', 'hubspot'] }) })), 'sign_in')
  assert.match(await t.run({ connector: 'other' }), /not one of this agent's connectors/)
  assert.equal(await t.run({ connector: 'crm-login' }), 'signed in as ops@acme.com — now on https://crm.example.com/home (Home)')
  assert.match(await t.run({ connector: 'hubspot' }), /^not signed in: hubspot holds no website login/)
  assert.deepEqual(f.signIns.map((s) => s.connector), ['crm-login', 'hubspot'])
  const dry = tool(agentTools(ctx(f, { brief: brief({ connectors: ['crm-login'], dryRun: true }) })), 'sign_in')
  assert.equal(await dry.run({ connector: 'crm-login' }), 'DRY RUN — would sign in with crm-login')
})

test('run_agent: a name of the parent space, when shared — in the parent, as its author; never sideways or down', async () => {
  const f = fakes()
  // The space has `digest`; the parent shares `house-report`; nothing has `ghost`.
  f.deps.findAgentState = async (space, name) => space === SPACE && name === 'digest'
  f.deps.sharedParentAgent = async (space, name) =>
    space === SPACE && name === 'house-report' ? { id: 'parent-1', name: 'Visvine HQ' } : null
  const run = tool(agentTools(ctx(f)), 'run_agent')
  assert.equal(await run.run({ name: 'digest' }), 'started agent digest — run run-digest')
  assert.deepEqual(f.claims[0], { name: 'digest', startedBy: 'author-1', chain: { parent: 'run-root', depth: 1 } })
  assert.match(await run.run({ name: 'house-report' }), /^started agent house-report in Visvine HQ .* as its own author — run run-house-report/)
  assert.deepEqual(f.claims[1], {
    name: 'house-report',
    startedBy: 'author-1',
    chain: { parent: 'run-root', depth: 1 },
    space: 'parent-1',
    runAs: 'author',
  })
  assert.match(await run.run({ name: 'ghost' }), /^error: no agent named ghost here/)
  assert.equal(f.claims.length, 2)
  // Only one step up: the lookup is asked about THIS space, never another.
  const asked: string[] = []
  f.deps.sharedParentAgent = async (space) => {
    asked.push(space)
    return null
  }
  await tool(agentTools(ctx(f)), 'run_agent').run({ name: 'ghost' })
  assert.deepEqual(asked, [SPACE])
  // Dry run says where it would have gone, and claims nothing.
  f.deps.sharedParentAgent = async () => ({ id: 'parent-1', name: 'Visvine HQ' })
  const dry = tool(agentTools(ctx(f, { brief: brief({ dryRun: true }) })), 'run_agent')
  assert.equal(await dry.run({ name: 'house-report' }), 'DRY RUN — would start agent house-report in Visvine HQ')
  assert.equal(f.claims.length, 2)
})

test('run_agent: any agent of the space, never itself, and refused past the depth limit', async () => {
  const f = fakes()
  const at = (depth: number) => tool(agentTools(ctx(f, { brief: brief({ agents: ['digest', 'weekly-digest'] }), chainDepth: depth })), 'run_agent')
  // `agents:` lists the ones the brief had in mind; it is not a fence.
  assert.equal(await at(0).run({ name: 'unknown' }), 'started agent unknown — run run-unknown')
  assert.match(await at(0).run({ name: '' }), /^error: name is required/)
  assert.match(await at(0).run({ name: 'weekly-digest' }), /cannot start itself/)
  assert.equal(await at(0).run({ name: 'digest' }), 'started agent digest — run run-digest')
  assert.deepEqual(f.claims[1], { name: 'digest', startedBy: 'author-1', chain: { parent: 'run-root', depth: 1 } })
  assert.equal(await at(1).run({ name: 'digest' }), 'started agent digest — run run-digest')
  assert.equal(f.claims[2].chain.depth, 2)
  assert.match(await at(MAX_CHAIN_DEPTH).run({ name: 'digest' }), /chain depth limit/)
  assert.equal(f.claims.length, 3)
  // The claim's own refusal comes back with its code.
  f.deps.claimManualRun = async () => ({ ok: false, code: 'inactive', message: 'not active' })
  assert.equal(await at(0).run({ name: 'digest' }), 'error (inactive): not active')
})

test('write_context / append_context report every path to onWrite; dry_run captures instead of writing', async () => {
  const f = fakes()
  const written: string[] = []
  const live = agentTools(ctx(f, { onWrite: (p) => written.push(p) }))
  assert.equal(await tool(live, 'write_context').run({ path: 'reports/weekly.md', content: '# hi' }), 'written reports/weekly.md')
  assert.equal(await tool(live, 'append_context').run({ path: 'log.md', text: 'entry' }), 'appended to log.md')
  assert.deepEqual(written, ['reports/weekly.md', 'log.md'])
  assert.equal(f.writes.length, 1)
  assert.equal(f.appends.length, 1)

  const g = fakes()
  const dryWritten: string[] = []
  const dry = agentTools(ctx(g, { brief: brief({ dryRun: true, tools: ['directory'], agents: ['digest'] }), onWrite: (p) => dryWritten.push(p) }))
  assert.equal(await tool(dry, 'write_context').run({ path: 'reports/weekly.md', content: '# hi' }), 'DRY RUN — would write reports/weekly.md (4 bytes)')
  assert.equal(await tool(dry, 'append_context').run({ path: 'log.md', text: 'entry' }), 'DRY RUN — would append to log.md (5 bytes)')
  assert.match(await tool(dry, 'create_node').run({ type: 'person', name: 'Jane' }), /^DRY RUN — would create person "Jane"/)
  assert.match(await tool(dry, 'link_nodes').run({ from: 'person:a', to: 'person:b' }), /^DRY RUN — would link/)
  assert.match(await tool(dry, 'run_agent').run({ name: 'digest' }), /^DRY RUN — would start agent digest/)
  assert.deepEqual(dryWritten, ['reports/weekly.md', 'log.md'])
  assert.equal(g.writes.length + g.appends.length + g.created.length + g.links.length + g.claims.length, 0, 'nothing executed')
})

test('directory tools go through createEntity / linkNodes as the author', async () => {
  const f = fakes()
  const tools = agentTools(ctx(f, { brief: brief({ tools: ['directory'] }) }))
  const written: string[] = []
  const withWrites = agentTools(ctx(f, { brief: brief({ tools: ['directory'] }), onWrite: (p) => written.push(p) }))
  assert.equal(await tool(withWrites, 'create_node').run({ type: 'person', name: 'Jane', description: 'CEO', tags: ['founder'] }), 'created person:Jane (note people/Jane.md)')
  assert.deepEqual(written, ['people/Jane.md'])
  // Stamped like write_context: Freeze-for-AI applies and the create can't wake this agent.
  assert.deepEqual(f.created, [{ type: 'person', name: 'Jane', stamp: { origin: 'agent', model: 'agent:weekly-digest' } }])
  assert.equal(await tool(tools, 'link_nodes').run({ from: 'person:jane', to: 'space:halter', type: 'works_at' }), 'linked person:jane → space:halter (works_at)')
  assert.deepEqual(f.links, [{ from: 'person:jane', to: 'space:halter', relationship: 'works_at' }])
  assert.match(await tool(tools, 'link_nodes').run({ from: 'a', to: 'a' }), /must differ/)
  f.deps.linkNodes = async () => 'no such node in this space: space:nope'
  const refusing = agentTools(ctx(f, { brief: brief({ tools: ['directory'] }) }))
  assert.equal(await tool(refusing, 'link_nodes').run({ from: 'person:jane', to: 'space:nope' }), 'error: no such node in this space: space:nope')
})

/** A model that plays back a fixed list of replies, then answers plainly. */
function scripted(replies: Partial<ChatWithToolsResult>[]): ChatFn {
  let i = 0
  return async (): Promise<ChatWithToolsResult> => {
    const r = replies[i++] ?? { content: 'done', toolCalls: [] }
    return { content: r.content ?? null, toolCalls: r.toolCalls ?? [], usage: r.usage ?? null }
  }
}

test('through the loop: a dry-run write shows up as a tool_result line, and a refusal is an error the model sees', async () => {
  const f = fakes()
  const written: string[] = []
  const tools = agentTools(ctx(f, { brief: brief({ dryRun: true }), onWrite: (p) => written.push(p) }))
  const events: ToolLoopEvent[] = []
  const chatFn = scripted([
    { content: 'writing', toolCalls: [{ id: 'c1', name: 'write_context', arguments: JSON.stringify({ path: 'reports/x.md', content: 'body' }) }] },
    { content: 'chaining', toolCalls: [{ id: 'c2', name: 'run_agent', arguments: JSON.stringify({ name: 'weekly-digest' }) }] },
    { content: 'all done' },
  ])
  const result = await runToolLoop({ messages: [{ role: 'user', content: 'go' }], tools, maxTurns: 6, chatFn, onEvent: (e) => events.push(e) })
  assert.equal(result.reason, 'finished')
  const results = events.filter((e): e is Extract<ToolLoopEvent, { type: 'tool_result' }> => e.type === 'tool_result')
  assert.equal(results[0].text, 'DRY RUN — would write reports/x.md (4 bytes)')
  assert.deepEqual(written, ['reports/x.md'])
  assert.match(results[1].text, /^error:/, 'an agent cannot chain into itself')
})

test('the machine comes with the space: run_command and open_page, stamped with the run, and a dry run touches neither', async () => {
  const f = fakes()
  const live = agentTools(ctx(f, { brief: brief({ tools: ['machine'] }) }))
  assert.ok(names(live).includes('run_command') && names(live).includes('open_page'))
  assert.ok(names(agentTools(ctx(f))).includes('run_command'), 'no opt-in needed')
  const off = agentTools(ctx(f, { brief: brief({ tools: ['machine'] }), deps: { ...f.deps, machineAvailable: () => false } }))
  assert.ok(!names(off).includes('run_command'), 'not without a substrate')

  const out = await tool(live, 'run_command').run({ command: ['python3', '-c', 'print(1)'] })
  assert.match(out, /^exit 0/)
  assert.match(out, /machine woke/)
  assert.deepEqual(f.commands, [{ cmd: ['python3', '-c', 'print(1)'], runId: 'run-root', taskAllow: [] }])
  assert.match(await tool(live, 'run_command').run({ command: [] }), /^error/)
  assert.match(await tool(live, 'open_page').run({ url: 'http://x' }), /^error/)
  assert.match(await tool(live, 'open_page').run({ url: 'https://x.example/' }), /^opened https:\/\/x\.example\//)
  assert.deepEqual(f.pages, [{ url: 'https://x.example/', taskAllow: [] }])

  const dry = agentTools(ctx(f, { brief: brief({ tools: ['machine'], dryRun: true }) }))
  assert.match(await tool(dry, 'run_command').run({ command: ['rm', '-rf', '/workspace'] }), /^DRY RUN/)
  assert.match(await tool(dry, 'open_page').run({ url: 'https://x.example/' }), /^DRY RUN/)
  assert.equal(f.commands.length, 1)
  assert.equal(f.pages.length, 1)
})

const PAGE: PageState = {
  url: 'https://crm.example.com/stays',
  title: 'Stays',
  text: 'Find a stay',
  scroll: { y: 0, height: 1600 },
  actions: [
    { id: 'e1', kind: 'fill', node: 11, role: 'textbox', label: 'City', value: '' },
    { id: 'e2', kind: 'select', node: 12, role: 'combobox', label: 'Style → Design', value: 'design', current_value: 'Any' },
    { id: 'e3', kind: 'select', node: 12, role: 'combobox', label: 'Style → Budget', value: 'budget', current_value: 'Any' },
    { id: 'e4', kind: 'click', node: 13, role: 'button', label: 'Search' },
    { id: 'scroll_down', kind: 'scroll', label: 'Scroll down', delta: 560 },
    { id: 'wait', kind: 'wait', label: 'Wait for the page to update' },
  ],
  guards: { '11': 'g11', '12': 'g12', '13': 'g13' },
  fingerprint: 'fp1',
  omitted: 0,
}

test('the page is a table: a snapshot lists rows, an act names one and presents its guard, and a moved page presses nothing', async () => {
  const f = fakes()
  const tools = agentTools(ctx(f, { machineAllow: ['crm.example.com'] }))
  assert.match(await tool(tools, 'page_act').run({ target: '3' }), /page_snapshot first/, 'a target is a row of a page that was read')

  const seen = await tool(tools, 'page_snapshot').run({})
  assert.match(seen, /\[1\] textbox "City" empty — fill, click/)
  assert.match(seen, /\[2:1\] Design/)
  assert.match(seen, /\[3\] button "Search" — click/)
  assert.deepEqual(f.pageCommands[0], { command: {}, runId: 'run-root', taskAllow: ['crm.example.com'] })

  await tool(tools, 'page_act').run({ target: '1', text: 'Lisbon' })
  assert.deepEqual(f.pageCommands[1].command.act, { kind: 'fill', node: 11, guard: 'g11', value: undefined, text: 'Lisbon', delta: undefined })
  await tool(tools, 'page_act').run({ target: '2:2' })
  assert.deepEqual(f.pageCommands[2].command.act, { kind: 'select', node: 12, guard: 'g12', value: 'budget', text: undefined, delta: undefined })
  await tool(tools, 'page_act').run({ target: 'scroll_down' })
  assert.equal(f.pageCommands[3].command.act?.kind, 'scroll')
  assert.match(await tool(tools, 'page_act').run({ target: '3', text: 'x' }), /not a field that takes text/)
  assert.match(await tool(tools, 'page_act').run({ target: '9' }), /no element 9/)
  assert.equal(f.pageCommands.length, 4, 'a row that is not there never reaches the machine')

  f.nextPage = { ok: false, reason: 'stale', state: { ...PAGE, title: 'Moved' } }
  assert.match(await tool(tools, 'page_act').run({ target: '3' }), /^NOT DONE[\s\S]*Moved/)

  const dry = agentTools(ctx(f, { brief: brief({ dryRun: true }) }))
  await tool(dry, 'page_snapshot').run({})
  const before = f.pageCommands.length
  assert.match(await tool(dry, 'page_act').run({ target: '3' }), /^DRY RUN/)
  assert.equal(f.pageCommands.length, before, 'a rehearsal reads the page and presses nothing')
})

test('browse_task hands the judge a goal and only the values the model supplied, and gives the page back', async () => {
  const f = fakes()
  const tools = agentTools(ctx(f, { deps: { ...f.deps, judgeAvailable: () => true } }))
  const out = await tool(tools, 'browse_task').run({ goal: 'Search stays in Lisbon', inputs: { city: 'Lisbon', bad: 7, '': 'x' } })
  assert.deepEqual(f.browsed, [{ goal: 'Search stays in Lisbon', inputs: { city: 'Lisbon' } }])
  assert.match(out, /^done — by its own account/)
  assert.match(out, /1\. type_text City ← Lisbon\n2\. click Search/)
  assert.match(out, /\[3\] button "Search"/, 'the page it ended on comes back for the model to check')
  // The table it ended on is the one page_act now acts on.
  await tool(tools, 'page_act').run({ target: '3' })
  assert.equal(f.pageCommands.at(-1)?.command.act?.guard, 'g13')
  assert.match(await tool(tools, 'browse_task').run({ goal: ' ' }), /^error/)
})

test('decide puts an agent\'s own questions to the judge, per item, on the space\'s allowance', async () => {
  const f = fakes()
  const on = { ...f.deps, judgeAvailable: () => true }
  const tools = agentTools(ctx(f, { deps: on }))
  const questions = [
    { id: 'urgent', ask: 'The email asks for something today.' },
    { id: 'kind', ask: 'What is this email?', type: 'choice', options: ['invoice', 'other'] },
  ]
  const out = await tool(tools, 'decide').run({ items: ['pay NOW', 'hello', 'newsletter'], questions })
  assert.deepEqual(f.judged, [{ items: 3, questions: ['urgent', 'kind'] }])
  assert.match(out, /^2 of 3 judged/)
  assert.match(out, /1\. urgent=0\.93 · kind=invoice \(0\.77\)/)
  assert.match(out, /2\. \(no answer\)/)
  assert.match(out, /3\. urgent=0\.04/)

  assert.match(await tool(tools, 'decide').run({ items: ['x'], questions: [{ id: 'k', ask: 'which', type: 'choice', options: ['one'] }] }), /2–40/)
  assert.match(await tool(tools, 'decide').run({ items: [], questions }), /^error/)
  const spent = agentTools(ctx(f, { deps: { ...on, takeSpaceJudgeAllowance: async () => ({ ok: false, retryAfterMs: 60_000 }) } }))
  assert.match(await tool(spent, 'decide').run({ items: ['x'], questions }), /do not call decide again this run/)
  assert.equal(f.judged.length, 1, 'out of allowance asks nothing')
  // A short wait is waited out rather than handed back.
  let asks = 0
  const brief = agentTools(ctx(f, { deps: { ...on, takeSpaceJudgeAllowance: async () => (asks++ === 0 ? { ok: false, retryAfterMs: 20 } : { ok: true, retryAfterMs: 0 }) } }))
  assert.match(await tool(brief, 'decide').run({ items: ['x', 'y'], questions }), /judged/)
  assert.equal(f.judged.length, 2)
})
