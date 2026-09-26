import { useMemo, useState } from 'react'
import {
  daysFrom,
  formatDate,
  formatMoney,
  formatNumber,
  HueDot,
  optionsOf,
  FieldValue,
  PersonAvatar,
  Page,
  peopleOf,
  plural,
  RecordBoard,
  RecordDialog,
  RecordsEmpty,
  RecordTable,
  Select,
  Spinner,
  Stat,
  StatRow,
  Toolbar,
  useBandAction,
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
      if (typeof v === 'string' && /^(?:0|[+-]\d+)$/.test(v)) {
        const d = new Date()
        d.setDate(d.getDate() + Number(v))
        out[key] = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
    }
    return out
  })
}

/** A stage that means finished, for a spec that did not say which: these are never open, never late. */
const FINISHED = /^(?:done|complete[d]?|closed|cancel+ed|won|lost|resolved|fixed|shipped|published|archived|rejected|declined|hired|finished|paid|delivered|dropped|abandoned|passed|not a fit|won't fix|wont fix)$/i

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function App() {
  const visvine = useVisvine()
  const samples = useMemo(() => resolveDates(SPEC.sample), [])
  const sampleRows = useSampleRows('items', samples)
  const { data, loading } = useCollection<RecordData>('items', { limit: 200 })
  const rows: Row[] = data ?? []

  const group = SPEC.fields.find((f) => f.key === SPEC.groupBy && f.kind === 'select')
  const dateField = SPEC.fields.find((f) => f.key === SPEC.dateField && f.kind === 'date')
  const sumField = SPEC.fields.find((f) => f.key === SPEC.sumField)
  const views = [
    ...(group ? [{ value: 'board', label: 'Board' }] : []),
    { value: 'table', label: 'Table' },
    ...(dateField ? [{ value: 'schedule', label: 'Schedule' }] : []),
  ]
  // The view is the band's section; a Tool with one view has none.
  const [section] = useSection()
  const view = views.some((v) => v.value === section) ? section! : views[0].value
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [draft, setDraft] = useState<RecordData>({})
  const startNew = (extra: RecordData = {}) => {
    setDraft({ ...(group ? { [group.key]: optionsOf(group)[0]?.value } : {}), ...extra })
    setEditing('new')
  }

  useBandAction('new', () => startNew())

  const doneValues = SPEC.doneValues ?? (group ? optionsOf(group).map((o) => o.value).filter((v) => FINISHED.test(v)) : [])
  const done = new Set(doneValues)
  const isDone = (r: Row) => Boolean(group) && done.has(String(r.data[group!.key] ?? ''))
  const isLate = (r: Row) => Boolean(dateField) && !isDone(r) && (daysFrom(r.data[dateField!.key]) ?? 0) < 0

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter && group && String(row.data[group.key] ?? '') !== filter) return false
      if (onlyOverdue && !isLate(row)) return false
      if (!q) return true
      return SPEC.fields.some((f) => String(row.data[f.key] ?? '').toLowerCase().includes(q))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, filter, group, onlyOverdue])

  const open = rows.filter((r) => !isDone(r))
  const overdue = rows.filter(isLate).length
  // A percent or a rating is averaged, never added up: three 70% key results are not 210%.
  const averaged = sumField?.kind === 'percent' || sumField?.kind === 'rating'
  const total = (list: Row[]) => {
    const values = list.map((r) => r.data[sumField?.key ?? '']).filter((v) => v !== null && v !== undefined && v !== '').map(Number).filter(Number.isFinite)
    const sum = values.reduce((a, b) => a + b, 0)
    return averaged ? (values.length ? sum / values.length : 0) : sum
  }
  const fmt = (n: number) => (sumField?.kind === 'money' ? formatMoney(n, sumField.currency) : averaged ? `${Math.round(n)}${sumField?.kind === 'percent' ? '%' : ''}` : formatNumber(n))
  const firstDone = group && doneValues[0]
  const doneCount = firstDone ? rows.filter((r) => String(r.data[group.key] ?? '') === firstDone).length : 0
  const closedCount = rows.filter(isDone).length
  // The first finish (Won, Fixed) out of everything closed, when there is more than one way to finish.
  const rate = doneValues.length > 1 && closedCount ? Math.round((doneCount / closedCount) * 100) : null
  const openTotal = total(open)
  const openCount = open.filter((r) => Number.isFinite(Number(r.data[sumField?.key ?? '']))).length

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
      <SampleData state={sampleRows} />
      <StatRow>
        {sumField ? (
          <Stat
            lead
            label={averaged ? `Average ${sumField.label.toLowerCase()}` : doneValues.length ? `Open ${sumField.label.toLowerCase()}` : `Total ${sumField.label.toLowerCase()}`}
            value={fmt(total(doneValues.length ? open : rows))}
            hint={!averaged && openCount > 0 ? `avg ${fmt(openTotal / openCount)} per ${SPEC.noun}` : `across ${open.length} open`}
          />
        ) : (
          <Stat lead label={`Open ${SPEC.plural}`} value={open.length} hint={`of ${rows.length}`} />
        )}
        {sumField && <Stat label={`Open ${SPEC.plural}`} value={open.length} hint={`of ${rows.length} in all`} />}
        {firstDone && (
          <Stat
            label={firstDone}
            value={doneCount}
            tone={doneCount > 0 && optionsOf(group!).find((o) => o.value === firstDone)?.hue === 'green' ? 'success' : undefined}
            hint={[sumField && !averaged ? fmt(total(rows.filter((r) => String(r.data[group!.key] ?? '') === firstDone))) : null, rate !== null ? `${rate}% of closed` : `${rows.length ? Math.round((doneCount / rows.length) * 100) : 0}% of all`].filter(Boolean).join(' · ')}
          />
        )}
        {dateField && (
          <Stat
            label="Overdue"
            value={overdue}
            tone={overdue > 0 ? 'danger' : undefined}
            hint={overdue ? (onlyOverdue ? 'Show all' : 'Show them') : 'none'}
            onClick={overdue ? () => setOnlyOverdue(!onlyOverdue) : undefined}
            active={onlyOverdue}
          />
        )}
      </StatRow>

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={`Search ${SPEC.plural}`}
        filters={
          group && view !== 'board' ? (
            <div className="w-44">
              <Select
                size="sm"
                aria-label={group.label}
                value={filter}
                onValueChange={setFilter}
                options={[{ value: '', label: `All ${plural(group.label.toLowerCase())}` }, ...optionsOf(group).map((o) => ({ value: o.value, label: o.label }))]}
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
        <div>
          <RecordBoard
            fields={SPEC.fields}
            groupBy={group.key}
            rows={shown}
            onMove={move}
            onOpen={setEditing}
            sumField={sumField?.key}
            dueField={dateField?.key}
            doneValues={doneValues}
            onAdd={(value) => startNew({ [group.key]: value })}
          />
        </div>
      ) : view === 'schedule' && dateField ? (
        <Schedule
          rows={shown.filter((r) => !isDone(r))}
          dateKey={dateField.key}
          group={group}
          person={SPEC.fields.find((f) => f.kind === 'person')}
          value={sumField && !averaged ? sumField : undefined}
          onOpen={setEditing}
          noDate={`No ${dateField.label.toLowerCase()}`}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <RecordTable
            fields={SPEC.fields}
            rows={shown}
            onOpen={setEditing}
            dueField={dateField?.key}
            isDone={isDone}
            defaultSort={dateField ? { key: dateField.key, direction: 'asc' } : undefined}
            empty={<span className="text-fg-muted">No {SPEC.plural} match.</span>}
          />
          <p className="px-3 text-xs text-fg-muted">
            {shown.length} {shown.length === 1 ? SPEC.noun : SPEC.plural}
            {sumField && !averaged ? ` · ${fmt(total(shown))} in all` : sumField && averaged ? ` · ${fmt(total(shown))} average` : ''}
          </p>
        </div>
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
        people={peopleOf(SPEC.fields, rows)}
        example={samples[0]}
      />
    </Page>
  )
}

/**
 * What is due, in the order it falls due: late, this week, next week, later,
 * then what has no date — every open row on one page, each where it belongs.
 */
function Schedule({ rows, dateKey, group, person, value, onOpen, noDate }: { rows: Row[]; dateKey: string; group?: FieldDef; person?: FieldDef; value?: FieldDef; onOpen: (row: Row) => void; noDate: string }) {
  const today = new Date()
  const toSunday = 7 - ((today.getDay() + 6) % 7)
  const buckets: Array<{ title: string; late?: boolean; test: (days: number | null) => boolean }> = [
    { title: 'Overdue', late: true, test: (d) => d !== null && d < 0 },
    { title: 'This week', test: (d) => d !== null && d >= 0 && d < toSunday },
    { title: 'Next week', test: (d) => d !== null && d >= toSunday && d < toSunday + 7 },
    { title: 'Later', test: (d) => d !== null && d >= toSunday + 7 },
    { title: noDate, test: (d) => d === null },
  ]
  const sorted = [...rows].sort((a, b) => String(a.data[dateKey] ?? '9999').localeCompare(String(b.data[dateKey] ?? '9999')))
  return (
    <div className="flex flex-col gap-6">
      {buckets.map((b) => {
        const list = sorted.filter((r) => b.test(daysFrom(r.data[dateKey])))
        if (!list.length) return null
        return (
          <section key={b.title}>
            <h2 className={`flex items-baseline gap-2 border-b border-line-subtle pb-2 text-sm font-semibold ${b.late ? 'text-danger' : 'text-fg'}`}>
              {b.title}
              <span className="font-normal text-fg-muted">{list.length}</span>
              {value && <span className="ml-auto font-normal tabular-nums text-fg-muted">{formatMoneyOrNumber(value, list)}</span>}
            </h2>
            <ul>
              {list.map((r) => {
                const option = group ? optionsOf(group).find((o) => o.value === r.data[group.key]) : undefined
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => onOpen(r)} className="flex w-full items-center gap-3 border-b border-line-subtle px-1 py-2.5 text-left text-sm hover:bg-surface-subtle">
                      <span className={`w-14 shrink-0 tabular-nums ${b.late ? 'font-medium text-danger' : 'text-fg-muted'}`}>{r.data[dateKey] ? formatDate(r.data[dateKey]) : '—'}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-fg">{String(r.data[SPEC.fields[0].key] ?? '') || 'Untitled'}</span>
                      {option && group && <FieldValue field={group} value={option.value} />}
                      {value && r.data[value.key] !== undefined && r.data[value.key] !== null && r.data[value.key] !== '' && (
                        <span className="w-24 shrink-0 text-right tabular-nums text-fg"><FieldValue field={value} value={r.data[value.key]} /></span>
                      )}
                      {person && r.data[person.key] ? (
                        <span className="flex w-36 shrink-0 items-center gap-1.5 truncate text-fg-secondary">
                          <PersonAvatar name={String(r.data[person.key])} />
                          <span className="truncate">{String(r.data[person.key])}</span>
                        </span>
                      ) : person ? <span className="w-36 shrink-0" /> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function formatMoneyOrNumber(field: FieldDef, list: Row[]): string {
  const sum = list.reduce((a, r) => a + (Number(r.data[field.key]) || 0), 0)
  return field.kind === 'money' ? formatMoney(sum, field.currency) : formatNumber(sum)
}
