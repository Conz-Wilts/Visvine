import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attachMachine, stepsOf, type MachineEvent } from '../lib/agents/shared/trace'
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

  it('never invents a step: extra execs pile onto the last machine step', () => {
    const steps = attachMachine(stepsOf(run.slice(0, 2)), [ev(1, 'exec'), ev(2, 'exit'), ev(3, 'exec'), ev(4, 'exit')])
    assert.equal(steps[0].machine?.length, 4)
  })

  it('leaves a run with no machine steps untouched', () => {
    const steps = attachMachine(stepsOf(run.slice(2, 4)), [ev(1, 'exec')])
    assert.equal(steps[0].machine, undefined)
  })
})
