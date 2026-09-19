/**
 * Runs for the dealflow digest that look like runs: several turns, each saying
 * what it is about to do and then making a handful of calls, one of them
 * refused, one a run FOR somebody else, one that gave up at the turn cap. The
 * agent page groups a run by turn (lib/agents/shared/trace.ts#groupSteps), and
 * a two-event trace shows none of that.
 */
import type { AgentRunEvent } from '../../../lib/agents/runs'

type Call = [tool: string, detail: string, result: string, seconds?: number]
type Turn = { say: string; calls?: Call[]; note?: string }

/** A trace from turns: each call takes `seconds`, each turn a breath before it. */
function trace(start: Date, turns: Turn[]): { events: AgentRunEvent[]; endedAt: Date } {
  let at = start.getTime()
  const events: AgentRunEvent[] = []
  for (const turn of turns) {
    at += 1_500
    if (turn.say) events.push({ at, type: 'assistant', text: turn.say })
    for (const [tool, detail, result, seconds = 2] of turn.calls ?? []) {
      events.push({ at, type: 'tool', tool, detail })
      at += seconds * 1_000
      events.push({ at, type: 'tool_result', tool, text: result })
    }
    if (turn.note) events.push({ at, type: 'system', text: turn.note })
  }
  return { events, endedAt: new Date(at + 1_000) }
}

export interface DemoRun {
  id: string
  trigger: 'scheduled' | 'manual' | 'event'
  status: 'succeeded' | 'failed'
  startedAt: Date
  endedAt: Date
  terminalReason: string
  summary: string | null
  errorMessage: string | null
  turns: number
  runAsUserId: string | null
  startedBy: string | null
  writes: string[]
  events: AgentRunEvent[]
}

export function digestDemoRuns(ago: (minutes: number) => Date, agent: string, member: string, admin: string): DemoRun[] {
  const digest = `agents/${agent}/digest.md`

  const morning: Turn[] = [
    {
      say: "I'll check my memory for when I last ran, then see what changed since.\n\nLast run was yesterday 09:00, so anything saved after that is new to me.",
      calls: [
        ['read_context', `agents/${agent}/memory.md`, '## What I know\n- last digest: yesterday 09:00\n- Quarterdeck is at proposal', 1],
        ['search_context', 'deals updated since yesterday', '5 notes: deals/quarterdeck-partners.md, deals/harbour-labs.md, deals/northline.md, deals/tidewater.md, deals/fernhill.md', 3],
      ],
    },
    {
      say: 'Reading the five deals that moved.',
      calls: [
        ['read_context', 'deals/quarterdeck-partners.md', 'Stage: Proposal · Owner: Ana · Next: pricing call Thursday', 1],
        ['read_context', 'deals/harbour-labs.md', 'Stage: Trial · 14 seats active · asked about SSO (again)', 1],
        ['read_context', 'deals/northline.md', 'Stage: Closed lost · went with an in-house build', 1],
        ['read_context', 'deals/tidewater.md', 'Stage: First call · accelerator, 40 companies a cohort', 1],
        ['read_context', 'deals/fernhill.md', 'Stage: Trial · no logins in 9 days', 1],
      ],
    },
    {
      say: "Now let me check the CRM before calling anything stalled — the notes lag it.",
      calls: [
        ['run_connector', 'crm · GET /deals?updated_since=yesterday', '{"deals":[{"name":"Fernhill","stage":"trial","last_activity":"2 days ago"},{"name":"Harbour Labs","stage":"trial","seats":14}]}', 6],
        ['fetch_url', 'https://status.fernhill.example/api/usage', 'error: status.fernhill.example is not a host this agent may reach', 1],
      ],
    },
    {
      say: 'Fernhill logged in two days ago according to the CRM, so it is quiet, not stalled. Checking which accounts changed health.',
      calls: [
        ['search_context', 'health changed spaces/', '2 notes: spaces/harbour-labs/index.md, spaces/juniper/index.md', 2],
        ['read_context', 'spaces/juniper/index.md', 'health: amber → green · renewed for 12 months', 1],
      ],
    },
    {
      say: "Write today's digest.",
      calls: [
        ['write_context', digest, `written ${digest}`, 2],
        ['append_context', `agents/${agent}/memory.md`, `appended to agents/${agent}/memory.md`, 1],
      ],
    },
    { say: 'Digest written: one stage change, one loss, Harbour Labs asked about SSO a second time, Juniper renewed.' },
  ]

  const forMember: Turn[] = [
    {
      say: "Let me see which of the deals that moved are this person's.",
      calls: [
        ['search_context', 'deals owner: Dev Member', '2 notes: deals/harbour-labs.md, deals/tidewater.md', 2],
        ['read_context', 'deals/harbour-labs.md', 'Stage: Trial · 14 seats active · asked about SSO (again)', 1],
        ['read_context', 'deals/tidewater.md', 'Stage: First call · accelerator, 40 companies a cohort', 1],
      ],
    },
    {
      say: 'Pull their open CRM tasks.',
      calls: [['run_connector', 'crm · GET /tasks?owner=me&open=true', '{"tasks":[{"deal":"Harbour Labs","due":"today","title":"Send SSO timeline"}]}', 5]],
    },
    { say: 'Write their digest.', calls: [['write_context', `agents/${agent}/for/dev-member.md`, `written agents/${agent}/for/dev-member.md`, 2]] },
  ]

  const capped: Turn[] = [
    {
      say: 'Someone asked: which accelerators have we spoken to this quarter?',
      calls: [
        ['search_context', 'accelerator', '11 notes', 3],
        ['read_context', 'deals/tidewater.md', 'Stage: First call · accelerator', 1],
        ['read_context', 'deals/kiln.md', 'Stage: First call · accelerator', 1],
      ],
    },
    {
      say: 'The notes do not say which quarter. Checking the CRM for created dates.',
      calls: [
        ['run_connector', 'crm · GET /deals?tag=accelerator', 'error: 429 Too Many Requests — retry after 30s', 2],
        ['run_connector', 'crm · GET /deals?tag=accelerator', 'error: 429 Too Many Requests — retry after 30s', 31],
      ],
      note: 'Stopped at the turn cap (30).',
    },
  ]

  const build = (id: string, startMinutesAgo: number, turns: Turn[], over: Partial<DemoRun>): DemoRun => {
    const startedAt = ago(startMinutesAgo)
    const { events, endedAt } = trace(startedAt, turns)
    return {
      id,
      trigger: 'scheduled',
      status: 'succeeded',
      startedAt,
      endedAt,
      terminalReason: 'finished',
      summary: null,
      errorMessage: null,
      turns: turns.length,
      runAsUserId: null,
      startedBy: null,
      writes: [],
      events,
      ...over,
    }
  }

  return [
    build('run_hq_digest_demo_morning', 30, morning, {
      summary: 'One stage change, one loss, Harbour Labs asked about SSO a second time, Juniper renewed.',
      writes: [digest, `agents/${agent}/memory.md`],
    }),
    build('run_hq_digest_demo_member', 28, forMember, { runAsUserId: member, writes: [`agents/${agent}/for/dev-member.md`] }),
    build('run_hq_digest_demo_capped', 400, capped, {
      trigger: 'manual',
      status: 'failed',
      terminalReason: 'max_turns',
      startedBy: admin,
      errorMessage: 'The CRM kept answering 429, and the run used its turns waiting on it.',
    }),
  ]
}
