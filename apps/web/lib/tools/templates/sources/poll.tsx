import { useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Page,
  Spinner,
  Textarea,
  useBandAction,
  useCollection,
  useSampleRows,
  useVisvine,
  type RecordData,
} from '@visvine/tool-kit'

interface Spec {
  /** What one thing asked is called: "poll", "question", "vote". */
  noun: string
  /** Polls the Tool opens with — a question, two to six answers, and how the team has voted so far (one count per answer). */
  sample: Array<{ question: string; options: string[]; tally?: number[] }>
}

// @spec
const SPEC: Spec = {
  noun: 'poll',
  sample: [
    { question: 'Where should the offsite be?', options: ['Lisbon', 'Barcelona', 'Amsterdam', 'Stay local'], tally: [6, 4, 3, 1] },
    { question: 'Which day works best for the weekly sync?', options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], tally: [2, 7, 3, 1] },
    { question: 'Should we move standup to async?', options: ['Yes', 'No', 'Try it for a month'], tally: [5, 2, 6] },
  ],
}
// @end-spec

type PollData = { question: string; options: string[]; tally?: number[]; closed?: boolean }
type Poll = { id: string; createdAt: string; data: PollData }
type Vote = { id: string; mine: boolean; data: { poll: string; choice: string } }

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function PollCard({ poll, votes, onVote, onClose }: { poll: Poll; votes: Vote[]; onVote: (poll: Poll, choice: string, current?: Vote) => void; onClose?: () => void }) {
  const mine = votes.find((v) => v.mine)
  const counts = poll.data.options.map((o, i) => (poll.data.tally?.[i] ?? 0) + votes.filter((v) => v.data.choice === o).length)
  const total = counts.reduce((a, b) => a + b, 0)
  const leader = Math.max(0, ...counts)
  const closed = Boolean(poll.data.closed)
  return (
    <section className="flex flex-col gap-3 border-b border-line-subtle pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{poll.data.question}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {total} {total === 1 ? 'vote' : 'votes'}
            {mine ? ` · you voted ${mine.data.choice}` : closed ? ' · closed' : ' · you have not voted'}
          </p>
        </div>
        {!closed && onClose && total > 0 && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={poll.data.question}>
        {poll.data.options.map((option, i) => {
          const share = total ? counts[i] / total : 0
          const chosen = mine?.data.choice === option
          const winning = counts[i] === leader && leader > 0
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={closed}
              onClick={() => onVote(poll, option, mine)}
              className={`group relative flex h-11 items-center gap-3 overflow-hidden rounded-lg border px-3 text-left text-sm transition-colors ${
                chosen ? 'border-accent' : 'border-line-subtle hover:border-line'
              } ${closed ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <span className={`absolute inset-y-0 left-0 transition-all ${winning ? 'bg-accent-soft' : 'bg-surface-subtle'}`} style={{ width: `${share * 100}%` }} />
              <span
                aria-hidden
                className={`relative flex size-4 shrink-0 items-center justify-center rounded-full border ${chosen ? 'border-accent-strong bg-accent-strong' : 'border-line group-hover:border-fg-muted'}`}
              >
                {chosen && <span className="size-1.5 rounded-full bg-surface" />}
              </span>
              <span className={`relative min-w-0 flex-1 truncate ${winning || chosen ? 'font-medium text-fg' : 'text-fg-secondary'}`}>{option}</span>
              <span className="relative tabular-nums text-fg-muted">
                {Math.round(share * 100)}% · {counts[i]}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default function App() {
  const visvine = useVisvine()
  useSampleRows('polls', useMemo(() => SPEC.sample as unknown as RecordData[], []))
  const polls = useCollection<PollData>('polls', { order: 'desc', limit: 100 })
  const votes = useCollection<Vote['data']>('votes', { limit: 200 })
  const [creating, setCreating] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState('')
  const [busy, setBusy] = useState(false)
  useBandAction('new', () => setCreating(true))

  const all = (polls.data ?? []) as Poll[]
  const ballot = (votes.data ?? []) as Vote[]
  const votesFor = (id: string) => ballot.filter((v) => v.data.poll === id)
  const open = all.filter((p) => !p.data.closed)
  const closed = all.filter((p) => p.data.closed)
  const voted = open.filter((p) => votesFor(p.id).some((v) => v.mine)).length
  const answers = options.split('\n').map((o) => o.trim()).filter(Boolean)

  const vote = async (poll: Poll, choice: string, current?: Vote) => {
    if (current?.data.choice === choice) return
    if (current) await visvine.collections.update('votes', current.id, { poll: poll.id, choice })
    else await visvine.collections.insert('votes', { poll: poll.id, choice })
  }

  const create = async () => {
    const list = [...new Set(answers)]
    if (!question.trim() || list.length < 2) return
    setBusy(true)
    try {
      await visvine.collections.insert('polls', { question: question.trim(), options: list.slice(0, 8) })
      setCreating(false)
      setQuestion('')
      setOptions('')
      void visvine.ui.toast(`${title(SPEC.noun)} created`, 'success')
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
      {open.length > 0 && (
        <p className="text-sm text-fg-muted">
          {open.length} open · you voted on <span className="font-medium text-fg">{voted}</span> of {open.length}
        </p>
      )}
      {open.length === 0 ? (
        <EmptyState title={`No open ${SPEC.noun}s`} action={<Button variant="primary" onClick={() => setCreating(true)}>New {SPEC.noun}</Button>} />
      ) : (
        open.map((poll) => (
          <PollCard
            key={poll.id}
            poll={poll}
            votes={votesFor(poll.id)}
            onVote={(p, c, cur) => void vote(p, c, cur)}
            onClose={() => void visvine.collections.update('polls', poll.id, { ...poll.data, closed: true })}
          />
        ))
      )}
      {closed.length > 0 && (
        <section className="flex flex-col gap-4">
          <button type="button" onClick={() => setShowClosed(!showClosed)} className="self-start text-sm font-medium text-fg-secondary hover:text-fg">
            {showClosed ? 'Hide' : 'Show'} {closed.length} closed
          </button>
          {showClosed && closed.map((poll) => <PollCard key={poll.id} poll={poll} votes={votesFor(poll.id)} onVote={() => {}} />)}
        </section>
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={`New ${SPEC.noun}`}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!question.trim() || answers.length < 2} onClick={() => void create()}>
              Create {SPEC.noun}
            </Button>
          </>
        }
      >
        <Field label="Question" htmlFor="q">
          <Input id="q" value={question} onChange={(e) => setQuestion(e.currentTarget.value)} placeholder={SPEC.sample[0]?.question ?? 'What should we decide?'} />
        </Field>
        <Field label="Answers" htmlFor="o" hint="One per line, two or more">
          <Textarea id="o" rows={5} value={options} onChange={(e) => setOptions(e.currentTarget.value)} placeholder={(SPEC.sample[0]?.options ?? ['First answer', 'Second answer']).join('\n')} />
        </Field>
      </Modal>
    </Page>
  )
}
