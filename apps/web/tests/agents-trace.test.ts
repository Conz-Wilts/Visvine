import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attachMachine, groupSteps, stepsOf, titleOfThought, type MachineEvent } from '../lib/agents/shared/trace'
import type { AgentRunEvent } from '../lib/agents/runs'

const ev = (seq: number, kind: string, payload: Record<string, unknown> = {}): MachineEvent => ({
  seq,
  kind,
  at: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
  payload,
})

describe('stepsOf', () => {
  it('folds a tool call and its result into one step, thoughts and notes between them', () => {
    const events: AgentRunEvent[] = [
      { at: 1, type: 'assistant', text: 'Looking' },
      { at: 2, type: 'tool', tool: 'read_context', detail: 'people/x/index.md' },
      { at: 3, type: 'tool_result', tool: 'read_context', text: '# X' },
      { at: 4, type: 'system', text: 'budget nearly reached' },
      { at: 5, type: 'tool', tool: 'write_context', detail: 'reports/x.md' },
    ]
    const steps = stepsOf(events)
    assert.deepEqual(
      steps.map((s) => [s.kind, s.tool ?? s.text, s.result]),
      [
        ['thought', 'Looking', undefined],
        ['tool', 'read_context', '# X'],
        ['note', 'budget nearly reached', undefined],
        ['tool', 'write_context', undefined],
      ],
    )
    assert.equal(steps[1].endedAt, 3)
  })

  it('keeps an orphan result as its own step rather than losing it', () => {
    const steps = stepsOf([{ at: 1, type: 'tool_result', tool: 'fetch_url', text: 'sent' }])
    assert.equal(steps.length, 1)
    assert.equal(steps[0].result, 'sent')
  })
})

describe('attachMachine', () => {
  const run: AgentRunEvent[] = [
    { at: 1, type: 'tool', tool: 'run_command', detail: 'ls' },
    { at: 2, type: 'tool_result', tool: 'run_command', text: 'exit 0' },
    { at: 3, type: 'tool', tool: 'read_context', detail: 'a.md' },
    { at: 4, type: 'tool_result', tool: 'read_context', text: '' },
    { at: 5, type: 'tool', tool: 'run_command', detail: 'python x.py' },
  ]

  it('nests each exec and its output under the machine step that asked for it, in order', () => {
    const steps = attachMachine(stepsOf(run), [
      ev(3, 'output', { text: 'a.md' }),
      ev(1, 'boot'),
      ev(2, 'exec', { cmd: ['ls'] }),
      ev(4, 'exit', { exitCode: 0 }),
      ev(5, 'exec', { cmd: ['python', 'x.py'] }),
      ev(6, 'egress_denied', { host: 'evil.example' }),
    ])
    assert.deepEqual(steps[0].machine?.map((e) => e.kind), ['boot', 'exec', 'output', 'exit'])
    assert.equal(steps[1].machine, undefined)
    assert.deepEqual(steps[2].machine?.map((e) => e.kind), ['exec', 'egress_denied'])
  })

  it('keeps a browse_task\'s whole loop — and a wake\'s script install — under its one step', () => {
    const page = (json: string) => ({ cmd: ['node', '/tmp/vv-page-abc.mjs', json] })
    const browsing: AgentRunEvent[] = [
      { at: 1, type: 'tool', tool: 'browse_task', detail: 'search Lisbon' },
      { at: 2, type: 'tool_result', tool: 'browse_task', text: 'done' },
      { at: 3, type: 'tool', tool: 'page_act', detail: '3' },
      { at: 4, type: 'tool_result', tool: 'page_act', text: 'did' },
    ]
    const steps = attachMachine(stepsOf(browsing), [
      ev(1, 'exec', page('{"task":true}')),
      ev(2, 'exec', { cmd: ['node', '-e', 'write', '/tmp/vv-page-abc.mjs', 'script'] }),
      ev(3, 'exec', page('{"task":true}')),
      ev(4, 'exec', page('{"task":true,"act":{"kind":"click"}}')),
      ev(5, 'exec', page('{"act":{"kind":"click"}}')),
    ])
    assert.equal(steps[0].machine?.length, 4)
    assert.equal(steps[1].machine?.length, 1)
  })

  it('never invents a step: extra execs pile onto the last machine step', () => {
    const steps = attachMachine(stepsOf(run.slice(0, 2)), [ev(1, 'exec'), ev(2, 'exit'), ev(3, 'exec'), ev(4, 'exit')])
    assert.equal(steps[0].machine?.length, 4)
  })

  it('leaves a run with no machine steps untouched', () => {
    const steps = attachMachine(stepsOf(run.slice(2, 4)), [ev(1, 'exec')])
    assert.equal(steps[0].machine, undefined)
  })
})

describe('groupSteps', () => {
  const run: AgentRunEvent[] = [
    { at: 1, type: 'system', text: 'Dry run: writes are captured, not applied.' },
    { at: 2, type: 'assistant', text: "I'll gather AI stories from Hacker News.\n\nFirst, the timestamp:\n- now" },
    { at: 3, type: 'tool', tool: 'fetch_url', detail: 'https://a' },
    { at: 4, type: 'tool_result', tool: 'fetch_url', text: 'ok' },
    { at: 5, type: 'tool', tool: 'fetch_url', detail: 'https://b' },
    { at: 6, type: 'tool_result', tool: 'fetch_url', text: 'error: refused' },
    { at: 7, type: 'assistant', text: '' },
    { at: 8, type: 'tool', tool: 'write_context', detail: 'digests/x.md' },
  ]

  it('opens a group at each thought and files the calls under it', () => {
    const groups = groupSteps(stepsOf(run))
    assert.deepEqual(
      groups.map((g) => [g.title, g.subtasks.length, g.state]),
      [
        ['Gather AI stories from Hacker News', 2, 'failed'],
        ['Wrote digests/x.md', 1, 'running'],
      ],
    )
    assert.deepEqual(groups[0].notes, ['Dry run: writes are captured, not applied.'])
    assert.equal(groups[0].endedAt, 6)
    assert.equal(groups[1].endedAt, null)
  })

  it('groups calls made before the model said anything, and keeps a lone note', () => {
    const groups = groupSteps(
      stepsOf([
        { at: 1, type: 'tool', tool: 'read_context', detail: 'a.md' },
        { at: 2, type: 'tool_result', tool: 'read_context', text: 'a' },
        { at: 3, type: 'tool', tool: 'read_context', detail: 'b.md' },
        { at: 4, type: 'tool_result', tool: 'read_context', text: 'b' },
      ]),
    )
    assert.deepEqual(groups.map((g) => g.title), ['Read 2 notes'])
    assert.deepEqual(groupSteps(stepsOf([{ at: 1, type: 'system', text: 'Stopped at the turn cap (6).' }])).map((g) => g.title), [
      'Stopped at the turn cap (6).',
    ])
  })

  it('keeps the machine record on a grouped subtask', () => {
    const steps = attachMachine(
      stepsOf([
        { at: 1, type: 'assistant', text: 'Let me run it.' },
        { at: 2, type: 'tool', tool: 'run_command', detail: 'ls' },
      ]),
      [ev(1, 'exec', { cmd: ['ls'] })],
    )
    assert.equal(groupSteps(steps)[0].subtasks[0].machine?.length, 1)
  })

  it('titles a thought by what it is about to do', () => {
    assert.equal(titleOfThought('Now let me **rank** the stories. Then write.'), 'Rank the stories')
    assert.equal(titleOfThought('## Plan\nmore'), 'Plan')
    assert.equal(titleOfThought('   '), '')
  })
})
