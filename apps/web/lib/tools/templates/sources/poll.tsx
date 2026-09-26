import { useMemo, useState } from 'react'
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Input,
  Modal,
  Page,
  Spinner,
  Stat,
  StatRow,
  Textarea,
  useBandAction,
  useCollection,
  useSampleRows,
  useSection,
  useVisvine,
  type RecordData,
} from '@visvine/tool-kit'

interface Spec {
  /** What one thing asked is called: "poll", "question", "vote". */
  noun: string
  /** Polls the Tool opens with — each a question and two to six answers. */
  sample: Array<{ question: string; options: string[] }>
}

// @spec
const SPEC: Spec = {
  noun: 'poll',
  sample: [
    { question: 'Where should the offsite be?', options: ['Lisbon', 'Barcelona', 'Amsterdam', 'Stay local'] },
    { question: 'Which day works best for the weekly sync?', options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'] },
    { question: 'Should we move standup to async?', options: ['Yes', 'No', 'Try it for a month'] },
  ],
}
// @end-spec

type Poll = { id: string; data: { question: string; options: string[]; closed?: boolean } }
type Vote = { id: string; mine: boolean; data: { poll: string; choice: string } }

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function PollCard({ poll, votes, onVote, onClose }: { poll: Poll; votes: Vote[]; onVote: (poll: Poll, choice: string, current?: Vote) => void; onClose?: () => void }) {
  const mine = votes.find((v) => v.mine)
  const total = votes.length
  const counts = poll.data.options.map((o) => votes.filter((v) => v.data.choice === o).length)
  const leader = Math.max(0, ...counts)
  const showResults = Boolean(mine) || poll.data.closed
  return (
    <section className="flex flex-col gap-3 border-b border-line-subtle pb-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-fg">{poll.data.question}</h2>
        {poll.data.closed ? <Chip>Closed</Chip> : onClose && total > 0 ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        {poll.data.options.map((option, i) => {
          const share = total ? counts[i] / total : 0
          const chosen = mine?.data.choice === option
          return (
            <button
              key={option}
              type="button"
              disabled={poll.data.closed}
              onClick={() => onVote(poll, option, mine)}
              className={`relative flex h-11 items-center justify-between overflow-hidden rounded-lg border px-3 text-left text-sm transition-colors ${
                chosen ? 'border-accent' : 'border-line-subtle hover:border-line'
              } ${poll.data.closed ? 'cursor-default' : 'cursor-pointer'}`}
            >
              {showResults && (
                <span
                  className={`absolute inset-y-0 left-0 transition-all ${counts[i] === leader && leader > 0 ? 'bg-accent-soft' : 'bg-surface-subtle'}`}
                  style={{ width: `${share * 100}%` }}
                />
              )}
              <span className="relative flex items-center gap-2 font-medium text-fg">
                {option}
                {chosen && <span className="text-xs font-normal text-accent">Your vote</span>}
              </span>
              {showResults && (
                <span className="relative tabular-nums text-fg-muted">
                  {Math.round(share * 100)}% · {counts[i]}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-fg-muted">
        {total} {total === 1 ? 'vote' : 'votes'}
        {!showResults && ' · vote to see results'}
      </p>
    </section>
  )
}

export default function App() {
  const visvine = useVisvine()
  const [section] = useSection()
  useSampleRows('polls', useMemo(() => SPEC.sample as unknown as RecordData[], []))
  const polls = useCollection<Poll['data']>('polls', { order: 'desc', limit: 100 })
  const votes = useCollection<Vote['data']>('votes', { limit: 200 })
  const [creating, setCreating] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState('')
  const [busy, setBusy] = useState(false)
  useBandAction('new', () => setCreating(true))

  const all = (polls.data ?? []) as Poll[]
  const ballot = (votes.data ?? []) as Vote[]
  const shown = all.filter((p) => (section === 'closed' ? p.data.closed : !p.data.closed))
  const votesFor = (id: string) => ballot.filter((v) => v.data.poll === id)
  const voters = ballot.length
  const mineCount = ballot.filter((v) => v.mine).length

  const vote = async (poll: Poll, choice: string, current?: Vote) => {
    if (current?.data.choice === choice) return
    if (current) await visvine.collections.update('votes', current.id, { poll: poll.id, choice })
    else await visvine.collections.insert('votes', { poll: poll.id, choice })
  }

  const create = async () => {
    const list = [...new Set(options.split('\n').map((o) => o.trim()).filter(Boolean))]
    if (!question.trim() || list.length < 2) return
    setBusy(true)
    try {
      await visvine.collections.insert('polls', { question: question.trim(), options: list.slice(0, 8) })
      setCreating(false)
      setQuestion('')
      setOptions('')
    } finally {
      setBusy(false)
    }
  }

  if (polls.loading && all.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  return (
    <Page width="normal">
      {section !== 'closed' && (
        <StatRow>
          <Stat label={`Open ${SPEC.noun}s`} value={all.filter((p) => !p.data.closed).length} />
          <Stat label="Votes cast" value={voters} />
          <Stat label="Yours" value={mineCount} hint={`of ${all.filter((p) => !p.data.closed).length}`} />
        </StatRow>
      )}
      {shown.length === 0 ? (
        <EmptyState
          title={section === 'closed' ? `No closed ${SPEC.noun}s` : `No open ${SPEC.noun}s`}
          action={section === 'closed' ? undefined : <Button variant="primary" onClick={() => setCreating(true)}>New {SPEC.noun}</Button>}
        />
      ) : (
        shown.map((poll) => (
          <PollCard
            key={poll.id}
            poll={poll}
            votes={votesFor(poll.id)}
            onVote={(p, c, cur) => void vote(p, c, cur)}
            onClose={() => void visvine.collections.update('polls', poll.id, { ...poll.data, closed: true })}
          />
        ))
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={`New ${SPEC.noun}`}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!question.trim() || options.split('\n').filter((o) => o.trim()).length < 2} onClick={() => void create()}>
              {title(SPEC.noun)}
            </Button>
          </>
        }
      >
        <Field label="Question" htmlFor="q">
          <Input id="q" autoFocus value={question} onChange={(e) => setQuestion(e.currentTarget.value)} placeholder="What should we…" />
        </Field>
        <Field label="Answers" htmlFor="o" hint="One per line">
          <Textarea id="o" rows={5} value={options} onChange={(e) => setOptions(e.currentTarget.value)} placeholder={'Yes\nNo'} />
        </Field>
      </Modal>
    </Page>
  )
}
