import { useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Page,
  Spinner,
  plural,
  useBandAction,
  useCollection,
  useSampleRows,
  SampleData,
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

function PollCard({ poll, votes, onVote, onClose, featured = false }: { poll: Poll; votes: Vote[]; onVote: (poll: Poll, choice: string, current?: Vote) => void; onClose?: () => void; featured?: boolean }) {
  const mine = votes.find((v) => v.mine)
  const counts = poll.data.options.map((o, i) => (poll.data.tally?.[i] ?? 0) + votes.filter((v) => v.data.choice === o).length)
  const total = counts.reduce((a, b) => a + b, 0)
  const leader = Math.max(0, ...counts)
  const leaders = counts.filter((c) => c === leader && leader > 0).length
  const closed = Boolean(poll.data.closed)
  return (
    <section className="mb-8 flex break-inside-avoid flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className={`font-semibold leading-snug text-fg ${featured ? 'text-xl' : 'text-base'}`}>{poll.data.question}</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            {total} {total === 1 ? 'vote' : 'votes'}
            {mine ? ` · you voted ${mine.data.choice}` : closed ? ' · closed' : ''}
          </p>
        </div>
        {!closed && onClose && total > 0 && (
          <Button size="sm" variant="ghost" onClick={onClose} className="shrink-0">
            End poll
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
              className={`group relative flex h-12 items-center gap-3 overflow-hidden rounded-lg border px-3 pb-1 text-left text-sm transition-colors ${
                chosen ? 'border-accent bg-accent-soft/40' : 'border-line-subtle hover:border-line hover:bg-surface-subtle'
              } ${closed ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <span aria-hidden className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full bg-surface-muted">
                <span className={`block h-full rounded-full transition-all ${winning ? 'bg-accent-strong' : 'bg-fg-subtle'}`} style={{ width: `${share * 100}%` }} />
              </span>
              <span
                aria-hidden
                className={`relative flex size-4 shrink-0 items-center justify-center rounded-full border ${chosen ? 'border-accent-strong bg-accent-strong' : 'border-line group-hover:border-fg-muted'}`}
              >
                {chosen && <span className="size-1.5 rounded-full bg-surface" />}
              </span>
              <span className={`relative min-w-0 flex-1 truncate ${winning || chosen ? 'font-medium text-fg' : 'text-fg-secondary'}`}>{option}</span>
              {chosen && <span className="relative rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-fg-secondary">Your vote</span>}
              {winning && total > 0 && <span className="relative rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent-strong">{leaders > 1 ? 'Tied' : closed ? 'Won' : 'Leading'}</span>}
              {!chosen && !closed && <span className="relative hidden text-xs font-medium text-fg-muted group-hover:inline">Vote</span>}
              <span className={`relative w-16 text-right tabular-nums ${winning ? 'font-semibold text-fg' : 'text-fg-muted'}`}>
                {Math.round(share * 100)}%<span className="font-normal text-fg-muted"> · {counts[i]}</span>
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
  const sampleRows = useSampleRows('polls', useMemo(() => SPEC.sample as unknown as RecordData[], []))
  const polls = useCollection<PollData>('polls', { order: 'desc', limit: 100 })
  const votes = useCollection<Vote['data']>('votes', { limit: 200 })
  const [creating, setCreating] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', '', ''])
  const [busy, setBusy] = useState(false)
  useBandAction('new', () => setCreating(true))

  // Newest first, except that the sample polls keep the spec's order (they are written in one go), after anything new.
  const sampleAt = (p: Poll) => SPEC.sample.findIndex((q) => q.question === p.data.question)
  const all = [...((polls.data ?? []) as Poll[])].sort((a, b) => {
    const ia = sampleAt(a)
    const ib = sampleAt(b)
    if (ia === -1 || ib === -1) return ia === ib ? b.createdAt.localeCompare(a.createdAt) : ia === -1 ? -1 : 1
    return ia - ib
  })
  const ballot = (votes.data ?? []) as Vote[]
  const votesFor = (id: string) => ballot.filter((v) => v.data.poll === id)
  const open = all.filter((p) => !p.data.closed)
  const closed = all.filter((p) => p.data.closed)
  const voted = open.filter((p) => votesFor(p.id).some((v) => v.mine)).length
  const answers = [...new Set(options.map((o) => o.trim()).filter(Boolean))]
  const votesCast = open.reduce((n, p) => n + (p.data.tally ?? []).reduce((a, b) => a + b, 0) + votesFor(p.id).length, 0)
  const endPoll = (poll: Poll) => void visvine.collections.update('polls', poll.id, { ...poll.data, closed: true })

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
      setOptions(['', '', ''])
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
    <Page>
      <SampleData state={sampleRows} />
      {open.length > 0 && (
        <p className="text-sm text-fg-muted">
          {open.length} open · {voted < open.length ? <span className="font-medium text-fg">{open.length - voted} waiting for your vote</span> : 'you have voted on all of them'} · {votesCast} votes cast
        </p>
      )}
      {open.length === 0 ? (
        <EmptyState title={`No open ${plural(SPEC.noun)}`} action={<Button variant="primary" onClick={() => setCreating(true)}>New {SPEC.noun}</Button>} />
      ) : (
        <>
          {/* The newest poll leads at full width; the rest sit two across under it. */}
          <div>
            <PollCard featured poll={open[0]} votes={votesFor(open[0].id)} onVote={(p, c, cur) => void vote(p, c, cur)} onClose={() => endPoll(open[0])} />
          </div>
          {open.length > 1 && (
            <div className="columns-1 gap-10 border-t border-line-subtle pt-6 md:columns-2">
              {open.slice(1).map((poll) => (
                <PollCard key={poll.id} poll={poll} votes={votesFor(poll.id)} onVote={(p, c, cur) => void vote(p, c, cur)} onClose={() => endPoll(poll)} />
              ))}
            </div>
          )}
        </>
      )}
      {closed.length > 0 && (
        <section className="flex flex-col gap-4">
          <button type="button" onClick={() => setShowClosed(!showClosed)} className="self-start text-sm font-medium text-fg-secondary hover:text-fg">
            {showClosed ? 'Hide' : 'Show'} {closed.length} closed
          </button>
          {showClosed && <div className="columns-1 gap-10 md:columns-2">{closed.map((poll) => <PollCard key={poll.id} poll={poll} votes={votesFor(poll.id)} onVote={() => {}} />)}</div>}
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
          <Input id="q" value={question} onChange={(e) => setQuestion(e.currentTarget.value)} placeholder={SPEC.sample[0] ? `e.g. ${SPEC.sample[0].question}` : 'What should we decide?'} />
        </Field>
        <Field label="Answers" htmlFor="answer-0">
          <div className="flex flex-col gap-2">
            {options.map((option, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  id={`answer-${i}`}
                  aria-label={`Answer ${i + 1}`}
                  value={option}
                  placeholder={SPEC.sample[0]?.options[i] ? `e.g. ${SPEC.sample[0].options[i]}` : `Answer ${i + 1}`}
                  onChange={(e) => setOptions(options.map((value, index) => (index === i ? e.currentTarget.value : value)))}
                />
                <button
                  type="button"
                  aria-label={`Remove answer ${i + 1}`}
                  disabled={options.length <= 2}
                  onClick={() => setOptions(options.filter((_, index) => index !== i))}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-subtle hover:text-fg disabled:invisible"
                >
                  ×
                </button>
              </div>
            ))}
            {options.length < 8 && (
              <button type="button" className="self-start rounded-md px-1 py-1 text-sm font-medium text-accent-strong hover:underline" onClick={() => setOptions([...options, ''])}>
                + Add answer
              </button>
            )}
          </div>
        </Field>
      </Modal>
    </Page>
  )
}
