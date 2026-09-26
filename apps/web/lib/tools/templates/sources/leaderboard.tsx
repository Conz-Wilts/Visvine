import { useMemo, useState } from 'react'
import {
  Button,
  Field,
  HueChip,
  hueColor,
  HUES,
  formatDate,
  Modal,
  Page,
  PersonAvatar,
  Segmented,
  Select,
  Spinner,
  Stat,
  StatRow,
  Textarea,
  useBandAction,
  useCollection,
  useSampleRows,
  SampleData,
  useSection,
  useVisvine,
  type Hue,
  type RecordData,
} from '@visvine/tool-kit'

interface Spec {
  /** What is counted: "points", "kudos", "km", "sales". */
  unit: string
  /** One of it, when that is a different word: "point", "sale". Same as `unit` when omitted. */
  unitOne?: string
  /** The act of adding some: "Give kudos", "Log a run". */
  actionLabel: string
  /** Quick amounts offered in the dialog. */
  amounts: number[]
  /** Kinds of entry, optional — "Helping out", "Shipping". */
  reasons?: string[]
  /** The people who start on the board. */
  people: string[]
  /** `from` is who gave it; left out, it is someone else on the board. */
  sample: Array<{ person: string; amount: number; reason?: string; note?: string; daysAgo: number; from?: string }>
}

// @spec
const SPEC: Spec = {
  unit: 'kudos',
  actionLabel: 'Give kudos',
  amounts: [1, 3, 5],
  reasons: ['Helped a teammate', 'Shipped something', 'Great idea', 'Went the extra mile'],
  people: ['Ana Silva', 'Sam Lee', 'Priya Nair', 'Tom Okafor', 'Jess Park'],
  sample: [
    { person: 'Priya Nair', amount: 5, reason: 'Went the extra mile', note: 'Stayed late to fix the release.', daysAgo: 1 },
    { person: 'Sam Lee', amount: 3, reason: 'Shipped something', note: 'CSV import is live!', daysAgo: 2 },
    { person: 'Ana Silva', amount: 3, reason: 'Great idea', note: 'The new onboarding checklist.', daysAgo: 3 },
    { person: 'Priya Nair', amount: 1, reason: 'Helped a teammate', daysAgo: 4 },
    { person: 'Tom Okafor', amount: 5, reason: 'Shipped something', note: 'Mobile nav redesign.', daysAgo: 6 },
    { person: 'Jess Park', amount: 1, reason: 'Helped a teammate', note: 'Paired on the flaky test.', daysAgo: 8 },
    { person: 'Sam Lee', amount: 1, reason: 'Helped a teammate', daysAgo: 9 },
    { person: 'Ana Silva', amount: 5, reason: 'Went the extra mile', note: 'Covered support all weekend.', daysAgo: 12 },
  ],
}
// @end-spec

type Entry = { id: string; data: { person: string; amount: number; reason?: string; note?: string; date: string; from?: string } }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgoIso = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return iso(d)
}
/** A reason keeps one hue wherever it is drawn — its chip, its bar. */
const reasonHue = (reason: string): Hue => HUES[Math.max(0, (SPEC.reasons ?? []).indexOf(reason)) % HUES.length]
const unitFor = (n: number) => (n === 1 ? (SPEC.unitOne ?? SPEC.unit) : SPEC.unit)
const PERIODS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All time' },
]

export default function App() {
  const visvine = useVisvine()
  const [section, goTo] = useSection()
  const samples = useMemo(
    () =>
      SPEC.sample.map(({ daysAgo, ...rest }, i) => {
        const d = new Date()
        d.setDate(d.getDate() - daysAgo)
        const others = SPEC.people.filter((p) => p !== rest.person)
        return { ...rest, from: rest.from ?? others[i % Math.max(1, others.length)], date: iso(d) } as RecordData
      }),
    [],
  )
  const sampleRows = useSampleRows('entries', samples)
  const { data, loading } = useCollection<Entry['data']>('entries', { order: 'desc', limit: 200 })
  // Newest first by the day it happened, not the order the rows were written.
  const entries = useMemo(() => [...((data ?? []) as Entry[])].sort((a, b) => b.data.date.localeCompare(a.data.date)), [data])
  const [period, setPeriod] = useState('month')
  const [who, setWho] = useState('')
  const [why, setWhy] = useState('')
  const [giving, setGiving] = useState(false)
  const [form, setForm] = useState<{ person: string; amount: number; reason: string; note: string }>({ person: '', amount: SPEC.amounts[0] ?? 1, reason: '', note: '' })
  const [busy, setBusy] = useState(false)
  useBandAction('give', () => setGiving(true))

  const since = useMemo(() => {
    const d = new Date()
    if (period === 'week') d.setDate(d.getDate() - 7)
    else if (period === 'month') d.setDate(d.getDate() - 30)
    else return ''
    return iso(d)
  }, [period])

  const people = useMemo(() => [...new Set([...SPEC.people, ...entries.map((e) => e.data.person)])].sort(), [entries])
  const ranking = useMemo(() => {
    const totals = new Map<string, { total: number; count: number }>()
    for (const p of people) totals.set(p, { total: 0, count: 0 })
    for (const e of entries) {
      if (since && e.data.date < since) continue
      const t = totals.get(e.data.person) ?? { total: 0, count: 0 }
      totals.set(e.data.person, { total: t.total + (Number(e.data.amount) || 0), count: t.count + 1 })
    }
    const sorted = [...totals.entries()].map(([person, t]) => ({ person, ...t })).sort((a, b) => b.total - a.total || a.person.localeCompare(b.person))
    // Equal totals share a place: 1, 1, 3.
    return sorted.map((r, i) => ({ ...r, place: sorted.findIndex((o) => o.total === r.total) + 1 }))
  }, [entries, people, since])
  const top = ranking[0]?.total || 1
  const periodTotal = ranking.reduce((a, r) => a + r.total, 0)

  const give = async () => {
    if (!form.person) return
    setBusy(true)
    try {
      await visvine.collections.insert('entries', { ...form, amount: Number(form.amount) || 0, date: iso(new Date()), from: visvine.viewer.name })
      setGiving(false)
      setForm({ person: '', amount: SPEC.amounts[0] ?? 1, reason: '', note: '' })
      void visvine.ui.toast(`${form.amount} ${unitFor(form.amount)} to ${form.person}`, 'success')
    } finally {
      setBusy(false)
    }
  }

  if (loading && entries.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  const dialog = (
    <Modal
      open={giving}
      onClose={() => setGiving(false)}
      title={SPEC.actionLabel}
      footer={
        <>
          <Button onClick={() => setGiving(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!form.person} onClick={() => void give()}>
            {SPEC.actionLabel}
          </Button>
        </>
      }
    >
      <Field label="To" htmlFor="to">
        <Select id="to" value={form.person} placeholder="Choose someone" options={people.map((p) => ({ value: p, label: p }))} onValueChange={(person) => setForm({ ...form, person })} />
      </Field>
      <Field label="Amount" htmlFor="amount">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${SPEC.amounts.length}, minmax(0, 1fr))` }}>
          {SPEC.amounts.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={form.amount === a}
              onClick={() => setForm({ ...form, amount: a })}
              className={`rounded-lg border py-2 text-sm font-semibold tabular-nums transition-colors ${form.amount === a ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-subtle text-fg hover:bg-surface-subtle'}`}
            >
              +{a} <span className="font-normal text-fg-muted">{unitFor(a)}</span>
            </button>
          ))}
        </div>
      </Field>
      {SPEC.reasons && SPEC.reasons.length > 0 && (
        <Field label="For" htmlFor="reason">
          <div className="flex flex-wrap gap-2">
            {SPEC.reasons.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={form.reason === r}
                onClick={() => setForm({ ...form, reason: form.reason === r ? '' : r })}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${form.reason === r ? 'border-accent bg-accent-soft font-medium text-fg' : 'border-line-subtle text-fg-secondary hover:bg-surface-subtle'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label="Note" htmlFor="note">
        <Textarea id="note" rows={2} value={form.note} placeholder={SPEC.sample.find((x) => x.note)?.note ? `e.g. ${SPEC.sample.find((x) => x.note)!.note}` : 'What did they do?'} onChange={(e) => setForm({ ...form, note: e.currentTarget.value })} />
      </Field>
    </Modal>
  )

  if (section === 'activity') {
    const listed = entries.filter((e) => (!who || e.data.person === who || e.data.from === who) && (!why || e.data.reason === why))
    const groups = [
      { title: 'This week', list: listed.filter((e) => e.data.date >= daysAgoIso(7)) },
      { title: 'Last week', list: listed.filter((e) => e.data.date < daysAgoIso(7) && e.data.date >= daysAgoIso(14)) },
      { title: 'Earlier', list: listed.filter((e) => e.data.date < daysAgoIso(14)) },
    ].filter((g) => g.list.length > 0)
    return (
      <Page width="normal" className="max-w-3xl">
        <SampleData state={sampleRows} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48">
            <Select size="sm" aria-label="Person" value={who} placeholder="Everyone" options={[{ value: '', label: 'Everyone' }, ...people.map((p) => ({ value: p, label: p }))]} onValueChange={setWho} />
          </div>
          {['', ...(SPEC.reasons ?? [])].map((r) => (
            <button
              key={r || 'all'}
              type="button"
              aria-pressed={why === r}
              onClick={() => setWhy(r)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${why === r ? 'border-fg bg-fg font-medium text-fg-inverse' : 'border-line-subtle text-fg-secondary hover:bg-surface-subtle'}`}
            >
              {r || 'All reasons'}
            </button>
          ))}
        </div>
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">Nothing matches.</p>
        ) : (
          groups.map((g) => (
            <section key={g.title}>
              <h2 className="flex items-baseline gap-2 border-b border-line-subtle pb-2 text-sm font-semibold text-fg">
                {g.title}
                <span className="font-normal text-fg-muted">
                  {g.list.reduce((a, e) => a + (Number(e.data.amount) || 0), 0)} {SPEC.unit}
                </span>
              </h2>
              <ul className="flex flex-col">
                {g.list.map((e) => (
                  <EntryRow key={e.id} entry={e} />
                ))}
              </ul>
            </section>
          ))
        )}
        {dialog}
      </Page>
    )
  }

  const leaders = ranking.filter((r) => r.place === 1 && r.total > 0)
  const leader = leaders[0] ?? null
  const periodLabel = PERIODS.find((p) => p.value === period)?.label.toLowerCase() ?? ''
  const inPeriod = entries.filter((e) => !since || e.data.date >= since)
  const reasonCounts = (SPEC.reasons ?? []).map((r) => ({ reason: r, n: inPeriod.filter((e) => e.data.reason === r).reduce((a, e) => a + (Number(e.data.amount) || 0), 0) })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n)
  const givers = new Map<string, number>()
  for (const e of inPeriod) if (e.data.from) givers.set(e.data.from, (givers.get(e.data.from) ?? 0) + (Number(e.data.amount) || 0))
  const topGiver = [...givers].sort((a, b) => b[1] - a[1])[0]
  return (
    <Page>
      <SampleData state={sampleRows} />
      <StatRow>
        <Stat
          lead
          label={`${leaders.length > 1 ? 'Tied for first' : 'Leader'} · ${period === 'all' ? 'all time' : `this ${periodLabel}`}`}
          value={leader ? (leaders.length > 2 ? `${leaders.length} people` : leaders.map((l) => l.person).join(' & ')) : '—'}
          hint={leader ? `${leader.total} ${unitFor(leader.total)}${leaders.length > 1 ? ' each' : ''}` : undefined}
        />
        <Stat label={`${SPEC.unit.charAt(0).toUpperCase() + SPEC.unit.slice(1)} given`} value={periodTotal} hint={`in ${inPeriod.length} ${inPeriod.length === 1 ? 'entry' : 'entries'}`} />
        {topGiver && <Stat label="Most generous" value={topGiver[0]} hint={`gave ${topGiver[1]} ${unitFor(topGiver[1])}`} />}
        {reasonCounts[0] && <Stat label="Most given for" value={reasonCounts[0].reason} hint={`${reasonCounts[0].n} ${unitFor(reasonCounts[0].n)}`} />}
      </StatRow>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-5">
        <section className="flex flex-col gap-2 md:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Ranking</h2>
            <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
          </div>
          <ol className="flex flex-col">
            {ranking.map((r) => {
              const first = r.place === 1 && r.total > 0
              return (
                <li key={r.person} className={`flex items-center gap-3 border-b border-line-subtle px-2 py-2.5 ${first ? 'bg-accent-soft' : ''}`}>
                  <span className={`w-5 text-center text-sm font-semibold tabular-nums ${first ? 'text-accent-strong' : 'text-fg-muted'}`}>{r.place}</span>
                  <PersonAvatar name={r.person} size="sm" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className={`truncate text-sm text-fg ${first ? 'font-semibold' : 'font-medium'}`}>{r.person}</span>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                      <div className={`h-full rounded-full transition-all ${first ? 'bg-accent-strong' : 'bg-fg-subtle'}`} style={{ width: `${(r.total / top) * 100}%` }} />
                    </div>
                  </div>
                  <span className="w-20 text-right text-sm font-semibold tabular-nums text-fg">
                    {r.total} <span className="font-normal text-fg-muted">{unitFor(r.total)}</span>
                  </span>
                </li>
              )
            })}
          </ol>
          {reasonCounts.length > 0 && (
            <div className="mt-6 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-fg">By reason</h2>
              {reasonCounts.map((r) => (
                <div key={r.reason} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 truncate text-fg-secondary">{r.reason}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <span className="block h-full rounded-full" style={{ width: `${(r.n / reasonCounts[0].n) * 100}%`, background: hueColor(reasonHue(r.reason)) }} />
                  </span>
                  <span className="w-10 text-right tabular-nums text-fg">{r.n}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="flex flex-col gap-2 md:col-span-2">
          <h2 className="text-sm font-semibold text-fg">Recent</h2>
          <ul className="flex flex-col">
            {entries.slice(0, 4).map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
          {entries.length > 4 && (
            <button type="button" onClick={() => goTo('activity')} className="self-start text-sm font-medium text-accent-strong hover:underline">
              See all {entries.length} →
            </button>
          )}
        </section>
      </div>
      {dialog}
    </Page>
  )
}

/** Who got how much, from whom and why — one line, the note under it. */
function EntryRow({ entry: e }: { entry: Entry }) {
  return (
    <li className="flex items-start gap-3 border-b border-line-subtle py-3">
      <PersonAvatar name={e.data.person} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">
          <span className="font-medium">{e.data.person}</span>
          {e.data.from && <span className="text-fg-muted"> from {e.data.from}</span>}
          <span className="text-fg-muted"> · {formatDate(e.data.date)}</span>
        </p>
        {e.data.note && <p className="mt-0.5 text-sm text-fg-secondary">{e.data.note}</p>}
        {e.data.reason && <HueChip hue={reasonHue(e.data.reason)} className="mt-1.5">{e.data.reason}</HueChip>}
      </div>
      <span className="shrink-0 rounded-md bg-accent-soft px-2 py-0.5 text-sm font-semibold tabular-nums text-accent-strong">+{e.data.amount}</span>
    </li>
  )
}
