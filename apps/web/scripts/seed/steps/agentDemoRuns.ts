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
      say: "I'll check my memory for when I last ran, then see what changed since.\n\nLast run was yesterday 08:00, so anything saved after that is new to me.",
      calls: [
        ['read_context', `agents/${agent}/memory.md`, '## What I know\n- last digest: yesterday 08:00\n- Banksia is going to committee', 1],
        ['search_context', 'dealflow updated since yesterday', '4 notes: dealflow/project-banksia.md, dealflow/project-wattle.md, dealflow/project-quokka.md, dealflow/project-kea.md', 3],
      ],
    },
    {
      say: 'Reading the four deals that moved.',
      calls: [
        ['read_context', 'dealflow/project-banksia.md', 'Stage: Investment committee · Owners: Michael Tolo, Tristan Edwards · Next: committee Monday', 1],
        ['read_context', 'dealflow/project-wattle.md', 'Stage: Diligence · waiting on a technical reference', 1],
        ['read_context', 'dealflow/project-quokka.md', 'Stage: Passed · the market, not the people', 1],
        ['read_context', 'dealflow/project-kea.md', 'Stage: First meeting · met at a Giants session', 1],
      ],
    },
    {
      say: 'Now let me check the CRM before calling anything stalled — the notes lag it.',
      calls: [
        ['run_connector', 'crm · GET /deals?updated_since=yesterday', '{"deals":[{"name":"Project Wattle","stage":"diligence","last_activity":"2 days ago"},{"name":"Project Kea","stage":"first_meeting"}]}', 6],
        ['fetch_url', 'https://status.wattle.example/api/pilot', 'error: status.wattle.example is not a host this agent may reach', 1],
      ],
    },
    {
      say: 'Wattle had activity two days ago according to the CRM, so it is waiting, not stalled. Checking the portfolio records that changed.',
      calls: [
        ['search_context', 'latest round changed spaces/', '2 notes: spaces/heidi-health/index.md, spaces/vessev/index.md', 2],
        ['read_context', 'spaces/heidi-health/index.md', 'Latest round: Series C (2026, US$100M, led by Blackbird)', 1],
      ],
    },
    {
      say: "Write today's digest.",
      calls: [
        ['write_context', digest, `written ${digest}`, 2],
        ['append_context', `agents/${agent}/memory.md`, `appended to agents/${agent}/memory.md`, 1],
      ],
    },
    { say: 'Digest written: Banksia to committee, Quokka passed, Wattle waiting on a reference, Heidi raised.' },
  ]

  const forMember: Turn[] = [
    {
      say: "Let me see which of the deals that moved came through this person's programs.",
      calls: [
        ['search_context', 'dealflow source: Giants', '1 note: dealflow/project-kea.md', 2],
        ['read_context', 'dealflow/project-kea.md', 'Stage: First meeting · met at a Giants session', 1],
      ],
    },
    {
      say: 'Pull their open CRM tasks.',
      calls: [['run_connector', 'crm · GET /tasks?owner=me&open=true', '{"tasks":[{"deal":"Project Kea","due":"today","title":"Send the pilot-site visit dates"}]}', 5]],
    },
    { say: 'Write their digest.', calls: [['write_context', `agents/${agent}/for/dev-member.md`, `written agents/${agent}/for/dev-member.md`, 2]] },
  ]

  const capped: Turn[] = [
    {
      say: 'Someone asked: which Foundry alumni have we met this year?',
      calls: [
        ['search_context', 'Foundry', '9 notes', 3],
        ['read_context', 'dealflow/project-wattle.md', 'Stage: Diligence · source: Foundry alumni', 1],
        ['read_context', 'dealflow/project-kowhai.md', 'Stage: First meeting · source: Foundry cohort 6', 1],
      ],
    },
    {
      say: 'The notes do not say when each first meeting was. Checking the CRM for created dates.',
      calls: [
        ['run_connector', 'crm · GET /deals?source=foundry', 'error: 429 Too Many Requests — retry after 30s', 2],
        ['run_connector', 'crm · GET /deals?source=foundry', 'error: 429 Too Many Requests — retry after 30s', 31],
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
    build('run_bb_digest_demo_morning', 30, morning, {
      summary: 'Banksia to committee, Quokka passed, Wattle waiting on a reference, Heidi raised.',
      writes: [digest, `agents/${agent}/memory.md`],
    }),
    build('run_bb_digest_demo_member', 28, forMember, { runAsUserId: member, writes: [`agents/${agent}/for/dev-member.md`] }),
    build('run_bb_digest_demo_capped', 400, capped, {
      trigger: 'manual',
      status: 'failed',
      terminalReason: 'max_turns',
      startedBy: admin,
      errorMessage: 'The CRM kept answering 429, and the run used its turns waiting on it.',
    }),
  ]
}
