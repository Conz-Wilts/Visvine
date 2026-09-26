import { useMemo, useState } from 'react'
import {
  daysFrom,
  formatMoney,
  formatNumber,
  MonthCalendar,
  optionsOf,
  Page,
  RecordBoard,
  RecordDialog,
  RecordsEmpty,
  RecordTable,
  Select,
  Spinner,
  Stat,
  StatRow,
  todayIso,
  Toolbar,
  useBandAction,
  useCollection,
  useSampleRows,
  useVisvine,
  type FieldDef,
  type RecordData,
} from '@visvine/tool-kit'

interface Spec {
  noun: string
  plural: string
  fields: FieldDef[]
  groupBy?: string
  sumField?: string
  dateField?: string
  doneValues?: string[]
  sample: RecordData[]
}

// @spec
const SPEC: Spec = {
  noun: 'deal',
  plural: 'deals',
  fields: [
    { key: 'name', label: 'Company', kind: 'text', required: true },
    {
      key: 'stage',
      label: 'Stage',
      kind: 'select',
      options: [
        { value: 'Lead', hue: 'gray' },
        { value: 'Qualified', hue: 'blue' },
        { value: 'Proposal', hue: 'violet' },
        { value: 'Won', hue: 'green' },
        { value: 'Lost', hue: 'red' },
      ],
    },
    { key: 'value', label: 'Value', kind: 'money' },
    { key: 'owner', label: 'Owner', kind: 'person' },
    { key: 'close', label: 'Close date', kind: 'date' },
    { key: 'notes', label: 'Notes', kind: 'longtext', hideInTable: true },
  ],
  groupBy: 'stage',
  sumField: 'value',
  dateField: 'close',
  doneValues: ['Won', 'Lost'],
  sample: [
    { name: 'Northwind', stage: 'Qualified', value: 48000, owner: 'Ana Silva', close: '+12' },
    { name: 'Globex', stage: 'Proposal', value: 120000, owner: 'Sam Lee', close: '+5' },
    { name: 'Initech', stage: 'Lead', value: 18000, owner: 'Ana Silva', close: '+30' },
    { name: 'Umbrella', stage: 'Won', value: 76000, owner: 'Priya Nair', close: '-4' },
    { name: 'Hooli', stage: 'Proposal', value: 95000, owner: 'Sam Lee', close: '-2' },
    { name: 'Stark Industries', stage: 'Qualified', value: 210000, owner: 'Priya Nair', close: '+21' },
    { name: 'Wayne Enterprises', stage: 'Lead', value: 64000, owner: 'Tom Okafor', close: '+45' },
    { name: 'Acme', stage: 'Lost', value: 22000, owner: 'Tom Okafor', close: '-10' },
    { name: 'Soylent', stage: 'Won', value: 38000, owner: 'Ana Silva', close: '-15' },
    { name: 'Vandelay', stage: 'Lead', value: 12000, owner: 'Sam Lee', close: '+60' },
  ],
}
// @end-spec

type Row = { id: string; data: RecordData }

/** `+12` / `-4` in sample rows are days from today, so a fresh install is always current. */
function resolveDates(rows: RecordData[]): RecordData[] {
  const dateKeys = SPEC.fields.filter((f) => f.kind === 'date').map((f) => f.key)
  return rows.map((row) => {
    const out = { ...row }
    for (const key of dateKeys) {
      const v = out[key]
      if (typeof v === 'string' && /^[+-]\d+$/.test(v)) {
        const d = new Date()
        d.setDate(d.getDate() + Number(v))
        out[key] = d.toISOString().slice(0, 10)
      }
    }
    return out
  })
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function App() {
  const visvine = useVisvine()
  useSampleRows('items', useMemo(() => resolveDates(SPEC.sample), []))
  const { data, loading } = useCollection<RecordData>('items', { limit: 200 })
  const rows: Row[] = data ?? []

  const group = SPEC.fields.find((f) => f.key === SPEC.groupBy && f.kind === 'select')
  const dateField = SPEC.fields.find((f) => f.key === SPEC.dateField && f.kind === 'date')
  const sumField = SPEC.fields.find((f) => f.key === SPEC.sumField)
  const views = [
    ...(group ? [{ value: 'board', label: 'Board' }] : []),
    { value: 'table', label: 'Table' },
    ...(dateField ? [{ value: 'calendar', label: 'Calendar' }] : []),
  ]
  const [view, setView] = useState(views[0].value)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [month, setMonth] = useState(todayIso())
  const [draft, setDraft] = useState<RecordData>({})
  const startNew = (extra: RecordData = {}) => {
    setDraft({ ...(group ? { [group.key]: optionsOf(group)[0]?.value } : {}), ...extra })
    setEditing('new')
  }

  useBandAction('new', () => startNew())

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter && group && String(row.data[group.key] ?? '') !== filter) return false
      if (!q) return true
      return SPEC.fields.some((f) => String(row.data[f.key] ?? '').toLowerCase().includes(q))
    })
  }, [rows, search, filter, group])

  const done = new Set(SPEC.doneValues ?? [])
  const open = group ? rows.filter((r) => !done.has(String(r.data[group.key] ?? ''))) : rows
  const overdue = dateField ? open.filter((r) => (daysFrom(r.data[dateField.key]) ?? 0) < 0).length : 0
  const total = (list: Row[]) => list.reduce((acc, r) => acc + (Number(r.data[sumField?.key ?? '']) || 0), 0)
  const fmt = (n: number) => (sumField?.kind === 'money' ? formatMoney(n, sumField.currency) : formatNumber(n))
  const firstDone = group && SPEC.doneValues?.[0]
  const doneCount = firstDone ? rows.filter((r) => String(r.data[group.key] ?? '') === firstDone).length : 0

  const save = async (value: RecordData) => {
    if (editing === 'new') {
      await visvine.collections.insert('items', value)
      void visvine.ui.toast(`${title(SPEC.noun)} added`, 'success')
    } else if (editing) {
      await visvine.collections.update('items', editing.id, value)
    }
    setEditing(null)
  }

  const remove = async () => {
    if (!editing || editing === 'new') return
    const ok = await visvine.ui.confirm({ title: `Delete this ${SPEC.noun}?`, confirmLabel: 'Delete', destructive: true })
    if (!ok) return
    await visvine.collections.delete('items', editing.id)
    setEditing(null)
  }

  const move = (row: Row, to: string) => {
    if (!group) return
    void visvine.collections.update('items', row.id, { ...row.data, [group.key]: to })
  }

  return (
    <Page>
      <StatRow>
        <Stat label={title(SPEC.plural)} value={rows.length} hint={group && SPEC.doneValues?.length ? `${open.length} open` : undefined} />
        {sumField && <Stat label={group && SPEC.doneValues?.length ? `Open ${sumField.label.toLowerCase()}` : `Total ${sumField.label.toLowerCase()}`} value={fmt(total(group && SPEC.doneValues?.length ? open : rows))} />}
        {firstDone && <Stat label={firstDone} value={doneCount} hint={sumField ? fmt(total(rows.filter((r) => String(r.data[group!.key] ?? '') === firstDone))) : undefined} />}
        {dateField && <Stat label="Overdue" value={overdue} hint={overdue ? `past ${dateField.label.toLowerCase()}` : undefined} />}
      </StatRow>

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={`Search ${SPEC.plural}`}
        views={views}
        view={view}
        onView={setView}
        filters={
          group ? (
            <div className="w-44">
              <Select
                size="sm"
                aria-label={group.label}
                value={filter}
                onValueChange={setFilter}
                options={[{ value: '', label: `All ${group.label.toLowerCase()}s` }, ...optionsOf(group).map((o) => ({ value: o.value, label: o.label }))]}
              />
            </div>
          ) : undefined
        }
      />

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <RecordsEmpty noun={SPEC.plural} onAdd={() => startNew()} />
      ) : view === 'board' && group ? (
        <div className="overflow-x-auto pb-2">
          <RecordBoard fields={SPEC.fields} groupBy={group.key} rows={shown} onMove={move} onOpen={setEditing} sumField={sumField?.key} />
        </div>
      ) : view === 'calendar' && dateField ? (
        <MonthCalendar
          month={month}
          onMonth={setMonth}
          items={shown
            .filter((r) => r.data[dateField.key])
            .map((r) => ({
              id: r.id,
              date: String(r.data[dateField.key]),
              title: String(r.data[SPEC.fields[0].key] ?? ''),
              hue: group ? optionsOf(group).find((o) => o.value === r.data[group.key])?.hue : undefined,
            }))}
          onOpen={(id) => setEditing(rows.find((r) => r.id === id) ?? null)}
          onDay={(date) => startNew({ [dateField.key]: date })}
        />
      ) : (
        <RecordTable fields={SPEC.fields} rows={shown} onOpen={setEditing} empty={<span className="text-fg-muted">No {SPEC.plural} match.</span>} />
      )}

      <RecordDialog
        open={editing !== null}
        title={editing && editing !== 'new' ? String(editing.data[SPEC.fields[0].key] || title(SPEC.noun)) : `New ${SPEC.noun}`}
        fields={SPEC.fields}
        initial={editing && editing !== 'new' ? editing.data : draft}
        onClose={() => setEditing(null)}
        onSave={save}
        onDelete={editing && editing !== 'new' ? remove : undefined}
        saveLabel={editing === 'new' ? `Add ${SPEC.noun}` : 'Save'}
      />
    </Page>
  )
}
