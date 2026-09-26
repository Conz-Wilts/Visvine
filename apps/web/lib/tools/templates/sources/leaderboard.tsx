import { useMemo, useState } from 'react'
import {
  Button,
  Field,
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
const unitFor = (n: number) => (n === 1 ? (SPEC.unitOne ?? SPEC.unit) : SPEC.unit)
const PERIODS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All time' },
]

export default function App() {
  const visvine = useVisvine()
  const [section] = useSection()
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
      <Field label={SPEC.unit.charAt(0).toUpperCase() + SPEC.unit.slice(1)} htmlFor="amount">
        <Segmented label="Amount" options={SPEC.amounts.map((a) => ({ value: String(a), label: String(a) }))} value={String(form.amount)} onChange={(v) => setForm({ ...form, amount: Number(v) })} />
      </Field>
      {SPEC.reasons && SPEC.reasons.length > 0 && (
        <Field label="For" htmlFor="reason">
          <Select id="reason" value={form.reason} placeholder="Choose a reason" options={SPEC.reasons.map((r) => ({ value: r, label: r }))} onValueChange={(reason) => setForm({ ...form, reason })} />
        </Field>
      )}
      <Field label="Note" htmlFor="note">
        <Textarea id="note" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.currentTarget.value })} />
      </Field>
    </Modal>
  )

  if (section === 'activity') {
    return (
      <Page width="normal">
      <SampleData state={sampleRows} />
        <ul className="flex flex-col">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} />
          ))}
        </ul>
        {dialog}
      </Page>
    )
  }

  const leader = ranking[0]?.total ? ranking[0] : null
  const periodLabel = PERIODS.find((p) => p.value === period)?.label.toLowerCase() ?? ''
  const inPeriod = entries.filter((e) => !since || e.data.date >= since)
  const reasonCounts = (SPEC.reasons ?? []).map((r) => ({ reason: r, n: inPeriod.filter((e) => e.data.reason === r).length })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n)
  return (
    <Page>
      <SampleData state={sampleRows} />
      <StatRow>
        <Stat lead label={`Leader · ${period === 'all' ? 'all time' : `this ${periodLabel}`}`} value={leader ? leader.person : '—'} hint={leader ? `${leader.total} ${unitFor(leader.total)}` : undefined} />
        <Stat label={`${SPEC.unit.charAt(0).toUpperCase() + SPEC.unit.slice(1)} given`} value={periodTotal} hint={`${inPeriod.length} ${inPeriod.length === 1 ? 'time' : 'times'}`} />
        <Stat label="People on the board" value={ranking.filter((r) => r.total > 0).length} hint={`of ${people.length}`} />
        {reasonCounts[0] && <Stat label="Most given for" value={reasonCounts[0].reason} hint={`${reasonCounts[0].n} ${reasonCounts[0].n === 1 ? 'time' : 'times'}`} />}
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
                <li key={r.person} className={`flex items-center gap-3 border-b border-line-subtle px-2 py-2.5 ${first ? 'rounded-lg border-transparent bg-accent-soft' : ''}`}>
                  <span className={`w-5 text-center text-sm font-semibold tabular-nums ${first ? 'text-accent-strong' : 'text-fg-muted'}`}>{r.place}</span>
                  <PersonAvatar name={r.person} size={first ? 'md' : 'sm'} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className={`truncate text-fg ${first ? 'text-base font-semibold' : 'text-sm font-medium'}`}>{r.person}</span>
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
        </section>
        <section className="flex flex-col gap-2 md:col-span-2">
          <h2 className="text-sm font-semibold text-fg">Recent</h2>
          <ul className="flex flex-col">
            {entries.slice(0, 6).map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
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
          <span className="font-semibold tabular-nums text-accent-strong"> +{e.data.amount}</span>
          {e.data.from && <span className="text-fg-muted"> from {e.data.from}</span>}
        </p>
        {e.data.reason && <span className="mt-1 inline-flex rounded-md bg-surface-muted px-1.5 py-0.5 text-xs text-fg-secondary">{e.data.reason}</span>}
        {e.data.note && <p className="mt-1 text-sm text-fg-secondary">{e.data.note}</p>}
      </div>
      <span className="shrink-0 text-xs text-fg-muted">{formatDate(e.data.date)}</span>
    </li>
  )
}
