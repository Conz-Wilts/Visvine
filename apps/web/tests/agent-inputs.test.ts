/**
 * An agent's inputs — declarations, each identity's values, what a run is
 * handed, and the record round trip. Pure.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agent-inputs.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyInputs,
  inputKeyOf,
  inputsFromLabels,
  inputsMessage,
  inputValuesDenial,
  inputValuesFor,
  missingInputs,
  parseAgentInputs,
  parseInputValues,
  type AgentInput,
} from '../lib/agents/shared/inputs'
import { applyConfigPatch, configColumns, configFromColumns, defaultAgentConfig, runsForColumns } from '../lib/agents/shared/agentConfig'
import { runsForDenial, type RunsForEntry } from '../lib/agents/shared/runsFor'
import { signInsOwed } from '../lib/agents/shared/needs'

const channel: AgentInput = { key: 'slack_channel', label: 'Slack channel', kind: 'text', options: [], required: true }
const tone: AgentInput = { key: 'tone', label: 'Tone', kind: 'select', options: ['brief', 'detailed'], required: false }
const entry = (userId: string, inputs: Record<string, string> = {}): RunsForEntry => ({ userId, at: null, timezone: null, model: null, inputs })

describe('parseAgentInputs', () => {
  it('reads keys, labels, kinds and the required default', () => {
    const r = parseAgentInputs(['slack_channel', { key: 'tone', label: 'Tone', kind: 'select', options: ['brief', 'detailed'], required: false }])
    assert.ok(r.ok)
    if (!r.ok) return
    assert.deepEqual(r.value, [{ ...channel, label: 'slack_channel' }, tone])
  })
  it('refuses a bad key, a duplicate, a select with no options, an unknown kind', () => {
    assert.equal(parseAgentInputs([{ key: 'Slack Channel' }]).ok, false)
    assert.equal(parseAgentInputs(['a', 'a']).ok, false)
    assert.equal(parseAgentInputs([{ key: 'tone', kind: 'select' }]).ok, false)
    assert.equal(parseAgentInputs([{ key: 'x', kind: 'number' }]).ok, false)
  })
})

describe('values', () => {
  it('parses a map, drops empties, refuses a non-key', () => {
    assert.deepEqual(parseInputValues({ slack_channel: ' D01 ', tone: '' }), { ok: true, value: { slack_channel: 'D01' } })
    assert.equal(parseInputValues({ 'Bad Key': 'x' }).ok, false)
    assert.equal(parseInputValues(['x']).ok, false)
  })
  it('holds a select to its options', () => {
    assert.equal(inputValuesDenial([tone], { tone: 'chatty' }), 'Tone must be one of brief, detailed')
    assert.equal(inputValuesDenial([tone], { tone: 'brief', other: 'kept' }), null)
  })
  it('names the required inputs left empty', () => {
    assert.deepEqual(missingInputs([channel, tone], {}), [channel])
    assert.deepEqual(missingInputs([channel, tone], { slack_channel: 'D01' }), [])
  })
  it('gives each identity its own values, never another person’s', () => {
    const record = { inputValues: { slack_channel: 'D-author' }, runsFor: [entry('bea', { slack_channel: 'D-bea' })] }
    assert.deepEqual(inputValuesFor(record, null, 'ana'), { slack_channel: 'D-author' })
    assert.deepEqual(inputValuesFor(record, 'ana', 'ana'), { slack_channel: 'D-author' })
    assert.deepEqual(inputValuesFor(record, 'bea', 'ana'), { slack_channel: 'D-bea' })
    assert.deepEqual(inputValuesFor(record, 'cy', 'ana'), {})
  })
})

describe('what a run is handed', () => {
  it('fills declared placeholders and leaves the rest as written', () => {
    const body = 'Post to {{ slack_channel }} in a {{tone}} voice; {{unknown}} stays.'
    assert.equal(applyInputs(body, [channel, tone], { slack_channel: 'D01' }), 'Post to D01 in a {{tone}} voice; {{unknown}} stays.')
  })
  it('lists every input with its value for the person', () => {
    const m = inputsMessage([channel, tone], { slack_channel: 'D01' }, 'Bea')
    assert.match(m ?? '', /for Bea/)
    assert.match(m ?? '', /slack_channel \(Slack channel\): D01/)
    assert.match(m ?? '', /tone \(Tone\): \(not set\)/)
    assert.equal(inputsMessage([], {}, 'Bea'), null)
  })
})

describe('the record', () => {
  it('round-trips inputs and every identity’s values through the columns', () => {
    const r = applyConfigPatch(defaultAgentConfig(), {
      inputs: [channel, tone],
      inputValues: { slack_channel: 'D-author' },
      runsFor: [entry('bea', { slack_channel: 'D-bea', tone: 'brief' })],
    })
    assert.ok(r.ok)
    if (!r.ok) return
    assert.deepEqual(configFromColumns(configColumns(r.config), runsForColumns(r.config.runsFor)), r.config)
  })
  it('refuses a value outside a select’s options', () => {
    const r = applyConfigPatch(defaultAgentConfig(), { inputs: [tone], runsFor: [entry('bea', { tone: 'chatty' })] })
    assert.equal(r.ok, false)
  })
  it('keeps a person’s values their own to change', () => {
    const before = [entry('bea', { slack_channel: 'D-bea' })]
    const after = [entry('bea', { slack_channel: 'D-ana' })]
    assert.ok(runsForDenial(before, after, { userId: 'ana', isAdmin: false }))
    assert.equal(runsForDenial(before, after, { userId: 'bea', isAdmin: false }), null)
  })
})

describe('labels', () => {
  it('mints keys from labels and keeps an existing declaration', () => {
    assert.equal(inputKeyOf('Slack channel'), 'slack_channel')
    assert.equal(inputKeyOf('#1 Inbox!'), 'inbox')
    assert.equal(inputKeyOf('123'), '')
    assert.deepEqual(inputsFromLabels(['Tone', ' Recipient ', ''], [tone]), [
      tone,
      { key: 'recipient', label: 'Recipient', kind: 'text', options: [], required: true },
    ])
  })
})

describe('signInsOwed', () => {
  it('names what the person must connect, and nothing for a brief fault', () => {
    assert.equal(signInsOwed([{ connector: 'slack', status: 'ok' }]), null)
    assert.equal(signInsOwed([{ connector: 'slack', status: 'invalid' }]), null)
    assert.match(signInsOwed([{ connector: 'slack', status: 'needs_connection', connectUrl: '/c' }]) ?? '', /slack is not signed in — sign in: \/c/)
    assert.match(signInsOwed([{ connector: 'gmail', status: 'missing', accountService: 'Gmail' }]) ?? '', /Gmail is not connected/)
  })
})
