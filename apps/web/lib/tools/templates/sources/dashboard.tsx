import { useMemo, useState } from 'react'
import {
  BarChart,
  Card,
  formatMoney,
  formatNumber,
  hueColor,
  optionsOf,
  Page,
  peopleOf,
  PieChart,
  Progress,
  RecordDialog,
  RecordsEmpty,
  RecordTable,
  Spinner,
  Stat,
  StatRow,
  Toolbar,
  useBandAction,
  useChartColors,
  useCollection,
  useSampleRows,
  SampleData,
  useSection,
  useVisvine,
  type FieldDef,
  type RecordData,
} from '@visvine/tool-kit'

interface Spec {
  noun: string
  plural: string
  fields: FieldDef[]
  /** The number every chart and stat adds up. */
  valueField: string
  /** The date each entry falls on. */
  dateField: string
  /** The select field the breakdown is by. */
  categoryField: string
  /** Optional: a monthly target for the value. */
  monthlyTarget?: number
  /** Higher is worse (spend, incidents): turns the change arrow's colours round. */
  lowerIsBetter?: boolean
  sample: RecordData[]
}

// @spec
const SPEC: Spec = {
  noun: 'expense',
  plural: 'expenses',
  fields: [
    { key: 'item', label: 'Item', kind: 'text', required: true },
    { key: 'amount', label: 'Amount', kind: 'money', required: true },
    {
      key: 'category',
      label: 'Category',
      kind: 'select',
      options: [
        { value: 'Software', hue: 'blue' },
        { value: 'Travel', hue: 'amber' },
        { value: 'Office', hue: 'green' },
        { value: 'Marketing', hue: 'violet' },
        { value: 'Meals', hue: 'pink' },
      ],
    },
    { key: 'date', label: 'Date', kind: 'date', required: true },
    { key: 'by', label: 'Spent by', kind: 'person' },
  ],
  valueField: 'amount',
  dateField: 'date',
  categoryField: 'category',
  monthlyTarget: 12000,
  lowerIsBetter: true,
  sample: [
    { item: 'Figma seats', amount: 540, category: 'Software', date: '-2', by: 'Ana Silva' },
    { item: 'Flights to Berlin', amount: 1280, category: 'Travel', date: '-5', by: 'Sam Lee' },
    { item: 'Team lunch', amount: 310, category: 'Meals', date: '-6', by: 'Priya Nair' },
    { item: 'LinkedIn campaign', amount: 2400, category: 'Marketing', date: '-9', by: 'Tom Okafor' },
    { item: 'Standing desks', amount: 1850, category: 'Office', date: '-12', by: 'Ana Silva' },
    { item: 'AWS', amount: 3120, category: 'Software', date: '-14', by: 'Sam Lee' },
    { item: 'Hotel, Lisbon', amount: 890, category: 'Travel', date: '-20', by: 'Priya Nair' },
    { item: 'Conference booth', amount: 4200, category: 'Marketing', date: '-26', by: 'Tom Okafor' },
    { item: 'Slack', amount: 720, category: 'Software', date: '-33', by: 'Ana Silva' },
    { item: 'Client dinner', amount: 460, category: 'Meals', date: '-38', by: 'Sam Lee' },
    { item: 'Printer', amount: 380, category: 'Office', date: '-44', by: 'Priya Nair' },
    { item: 'Train, Paris', amount: 240, category: 'Travel', date: '-51', by: 'Tom Okafor' },
    { item: 'Notion', amount: 480, category: 'Software', date: '-58', by: 'Ana Silva' },
    { item: 'Podcast ads', amount: 1600, category: 'Marketing', date: '-66', by: 'Sam Lee' },
  ],
}
// @end-spec

type Row = { id: string; data: RecordData }

function resolveDates(rows: RecordData[]): RecordData[] {
  const dateKeys = SPEC.fields.filter((f) => f.kind === 'date').map((f) => f.key)
  return rows.map((row) => {
    const out = { ...row }
    for (const key of dateKeys) {
      const v = out[key]
      if (typeof v === 'string' && /^(?:0|[+-]\d+)$/.test(v)) {
        const d = new Date()
        d.setDate(d.getDate() + Number(v))
        out[key] = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
    }
    return out
  })
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthOf = (value: unknown) => String(value ?? '').slice(0, 7)

/** The Monday of a date's week, as YYYY-MM-DD. */
function weekOf(value: unknown): string {
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return iso(d)
}

export default function App() {
  const visvine = useVisvine()
  const [section] = useSection()
  const sampleRows = useSampleRows('items', useMemo(() => resolveDates(SPEC.sample), []))
  const { data, loading } = useCollection<RecordData>('items', { limit: 200, order: 'desc' })
  // Newest first by the date each entry falls on, not by when it was typed in.
  const rows: Row[] = useMemo(() => [...((data ?? []) as Row[])].sort((a, b) => String(b.data[SPEC.dateField] ?? '').localeCompare(String(a.data[SPEC.dateField] ?? ''))), [data])
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<RecordData>({})
  const startNew = () => {
    setDraft({ [SPEC.dateField]: iso(new Date()) })
    setEditing('new')
  }
  useBandAction('new', startNew)

  const colors = useChartColors()
  const valueField = SPEC.fields.find((f) => f.key === SPEC.valueField)
  const category = SPEC.fields.find((f) => f.key === SPEC.categoryField)
  const fmt = (n: number) => (valueField?.kind === 'money' ? formatMoney(n, valueField.currency) : formatNumber(n))
  const valueOf = (r: Row) => Number(r.data[SPEC.valueField]) || 0
  const sum = (list: Row[]) => list.reduce((acc, r) => acc + valueOf(r), 0)

  const now = new Date()
  const thisMonth = iso(now).slice(0, 7)
  const last = iso(new Date(now.getFullYear(), now.getMonth() - 1, 15)).slice(0, 7)
  const inThis = rows.filter((r) => monthOf(r.data[SPEC.dateField]) === thisMonth)
  const inLast = rows.filter((r) => monthOf(r.data[SPEC.dateField]) === last)
  const change = inLast.length ? Math.round(((sum(inThis) - sum(inLast)) / Math.max(1, sum(inLast))) * 100) : undefined

  const byCategory = useMemo(() => {
    if (!category) return []
    return optionsOf(category)
      .map((o) => ({ name: o.label, hue: o.hue, total: rows.filter((r) => r.data[category.key] === o.value).reduce((a, r) => a + valueOf(r), 0) }))
      .filter((d) => d.total > 0)
      .sort((a, b) => b.total - a.total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, category])

  // The last ten weeks, each one present — a quiet week is a zero bar, not a gap a line would smooth over.
  const byWeek = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      const w = weekOf(r.data[SPEC.dateField])
      if (w) map.set(w, (map.get(w) ?? 0) + valueOf(r))
    }
    const weeks: Array<{ week: string; total: number }> = []
    const d = new Date(`${weekOf(iso(new Date()))}T00:00:00`)
    for (let i = 0; i < 10; i++) {
      const w = iso(d)
      weeks.unshift({ week: w, total: map.get(w) ?? 0 })
      d.setDate(d.getDate() - 7)
    }
    // Starting at the first week with anything in it.
    const firstFull = weeks.findIndex((w) => w.total > 0)
    return firstFull > 0 ? weeks.slice(Math.min(firstFull, weeks.length - 4)) : weeks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter((r) => SPEC.fields.some((f) => String(r.data[f.key] ?? '').toLowerCase().includes(q))) : rows
  }, [rows, search])

  const save = async (value: RecordData) => {
    if (editing === 'new') await visvine.collections.insert('items', value)
    else if (editing) await visvine.collections.update('items', editing.id, value)
    setEditing(null)
  }
  const remove = async () => {
    if (!editing || editing === 'new') return
    if (!(await visvine.ui.confirm({ title: `Delete this ${SPEC.noun}?`, confirmLabel: 'Delete', destructive: true }))) return
    await visvine.collections.delete('items', editing.id)
    setEditing(null)
  }

  const dialog = (
    <RecordDialog
      open={editing !== null}
      title={editing === 'new' ? `New ${SPEC.noun}` : title(SPEC.noun)}
      fields={SPEC.fields}
      initial={editing && editing !== 'new' ? editing.data : draft}
      onClose={() => setEditing(null)}
      onSave={save}
      onDelete={editing && editing !== 'new' ? remove : undefined}
      saveLabel={editing === 'new' ? `Add ${SPEC.noun}` : 'Save'}
      people={peopleOf(SPEC.fields, rows)}
      example={resolveDates(SPEC.sample)[0]}
    />
  )

  if (loading && rows.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <Page>
      <SampleData state={sampleRows} />
        <RecordsEmpty noun={SPEC.plural} onAdd={startNew} />
        {dialog}
      </Page>
    )
  }

  if (section === 'entries') {
    return (
      <Page>
      <SampleData state={sampleRows} />
        <Toolbar search={search} onSearch={setSearch} searchPlaceholder={`Search ${SPEC.plural}`} />
        <RecordTable fields={SPEC.fields} rows={shown} onOpen={setEditing} />
        {dialog}
      </Page>
    )
  }

  const monthCategories = category
    ? optionsOf(category)
        .map((o) => ({ name: o.label, total: sum(inThis.filter((r) => r.data[category.key] === o.value)) }))
        .filter((d) => d.total > 0)
        .sort((a, b) => b.total - a.total)
    : []
  const top = monthCategories[0]
  const categoryTotal = byCategory.reduce((acc, d) => acc + d.total, 0)
  // A category's slice, dot and chip are one colour: its option's hue.
  const sliceColors = byCategory.map((d) => hueColor(d.hue))
  const spent = sum(inThis)
  const used = SPEC.monthlyTarget ? spent / SPEC.monthlyTarget : 0
  const diff = spent - sum(inLast)
  // A swing too big to read as a percentage says how much instead.
  const deltaLabel = change === undefined ? undefined : Math.abs(change) > 150 ? fmt(Math.abs(diff)) : `${Math.abs(change)}%`
  const monthName = now.toLocaleDateString(undefined, { month: 'long' })
  return (
    <Page>
      <SampleData state={sampleRows} />
      <StatRow>
        {SPEC.monthlyTarget ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">{monthName}</span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tabular-nums text-fg">{fmt(spent)}</span>
              <span className="text-sm text-fg-muted">of {fmt(SPEC.monthlyTarget)}</span>
            </span>
            <Progress value={used} hue={SPEC.lowerIsBetter ? (used > 1 ? 'red' : used > 0.85 ? 'amber' : 'green') : used >= 1 ? 'green' : 'blue'} />
            <span className={`text-xs ${SPEC.lowerIsBetter && used > 1 ? 'font-medium text-danger' : 'text-fg-muted'}`}>
              {SPEC.lowerIsBetter
                ? used > 1
                  ? `${fmt(spent - SPEC.monthlyTarget)} over budget`
                  : `${fmt(SPEC.monthlyTarget - spent)} left · ${Math.round(used * 100)}% used`
                : `${Math.round(used * 100)}% of target`}
            </span>
          </div>
        ) : (
          <Stat lead label={monthName} value={fmt(spent)} delta={change} deltaLabel={deltaLabel} invert={SPEC.lowerIsBetter} hint="vs last month" />
        )}
        {SPEC.monthlyTarget ? (
          <Stat label="Last month" value={fmt(sum(inLast))} hint={change === undefined ? undefined : `${monthName} is ${diff >= 0 ? 'up' : 'down'} ${deltaLabel}`} />
        ) : (
          <Stat label="Last month" value={fmt(sum(inLast))} />
        )}
        <Stat label={title(SPEC.plural)} value={inThis.length} hint={`this month · ${rows.length} in all`} />
        {top && <Stat label={`Top ${category?.label.toLowerCase() ?? ''}`} value={top.name} hint={`${fmt(top.total)} this month`} />}
      </StatRow>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-5">
        <Card title={`By week · last ${byWeek.length} weeks`} className="md:col-span-3">
          <BarChart data={byWeek} x="week" series={[{ key: 'total', label: valueField?.label ?? 'Total', color: colors[0] }]} height={300} formatValue={fmt} legend={false} formatX={(w) => new Date(`${String(w)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} />
        </Card>
        {category && (
          <Card title={`By ${category.label.toLowerCase()} · all time`} className="md:col-span-2">
            <div className="flex flex-col gap-3">
              <div className="relative mx-auto w-36">
                <PieChart data={byCategory} nameKey="name" valueKey="total" height={144} donut legend={false} formatValue={fmt} colors={sliceColors} />
                <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-sm font-semibold tabular-nums text-fg">{fmt(categoryTotal)}</span>
                  <span className="text-[11px] text-fg-muted">all time</span>
                </span>
              </div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {byCategory.map((d, i) => (
                  <li key={d.name} className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: sliceColors[i] }} />
                    <span className="min-w-0 flex-1 truncate text-fg-secondary">{d.name}</span>
                    <span className="tabular-nums text-fg">{fmt(d.total)}</span>
                    <span className="w-9 text-right tabular-nums text-fg-muted">{categoryTotal ? Math.round((d.total / categoryTotal) * 100) : 0}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}
      </div>

      <Card title="Latest" flush>
        <RecordTable fields={SPEC.fields} rows={rows.slice(0, 6)} onOpen={setEditing} />
      </Card>
      {dialog}
    </Page>
  )
}
