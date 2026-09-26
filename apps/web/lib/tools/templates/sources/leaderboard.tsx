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
  sample: Array<{ person: string; amount: number; reason?: string; note?: string; daysAgo: number }>
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

const iso = (d: Date) => d.toISOString().slice(0, 10)
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
      SPEC.sample.map(({ daysAgo, ...rest }) => {
        const d = new Date()
        d.setDate(d.getDate() - daysAgo)
        return { ...rest, date: iso(d) } as RecordData
      }),
    [],
  )
  useSampleRows('entries', samples)
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
        <ul className="flex flex-col">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 border-b border-line-subtle py-3">
              <PersonAvatar name={e.data.person} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">
                  <span className="font-medium">{e.data.person}</span>
                  <span className="text-fg-muted"> got </span>
                  <span className="font-medium tabular-nums">
                    {e.data.amount} {unitFor(e.data.amount)}
                  </span>
                  {e.data.reason && <span className="text-fg-muted"> · {e.data.reason}</span>}
                </p>
                {e.data.note && <p className="mt-0.5 text-sm text-fg-secondary">{e.data.note}</p>}
              </div>
              <span className="shrink-0 text-xs text-fg-muted">{formatDate(e.data.date)}</span>
            </li>
          ))}
        </ul>
        {dialog}
      </Page>
    )
  }

  return (
    <Page width="normal">
      <StatRow>
        <Stat label="Leader" value={ranking[0]?.total ? ranking[0].person : '—'} hint={ranking[0]?.total ? `${ranking[0].total} ${SPEC.unit}` : undefined} />
        <Stat label={`${SPEC.unit.charAt(0).toUpperCase() + SPEC.unit.slice(1)} given`} value={periodTotal} />
        <Stat label="People" value={people.length} />
      </StatRow>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">Ranking</h2>
        <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
      </div>
      <ol className="flex flex-col">
        {ranking.map((r) => (
          <li key={r.person} className="flex items-center gap-4 border-b border-line-subtle py-3">
            <span className={`w-6 text-center text-sm font-semibold tabular-nums ${r.place === 1 && r.total > 0 ? 'text-accent' : 'text-fg-muted'}`}>{r.place}</span>
            <PersonAvatar name={r.person} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="truncate text-sm font-medium text-fg">{r.person}</span>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(r.total / top) * 100}%` }} />
              </div>
            </div>
            <span className="w-20 text-right text-sm tabular-nums text-fg">
              {r.total} <span className="text-fg-muted">{unitFor(r.total)}</span>
            </span>
          </li>
        ))}
      </ol>
      {dialog}
    </Page>
  )
}
