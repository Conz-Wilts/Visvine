import { useMemo, useState } from 'react'
import {
  Button,
  FieldValue,
  Icon,
  ListDetail,
  optionsOf,
  Page,
  PersonAvatar,
  RecordDialog,
  RecordsEmpty,
  Select,
  Spinner,
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
  /** The first field is the name each entry is listed by. */
  fields: FieldDef[]
  /** A select field the list can be narrowed by. */
  groupBy?: string
  /** A field shown under the name in the list. */
  subtitleField?: string
  /** Draw each entry with initials, like a person or a company. */
  avatar?: boolean
  sample: RecordData[]
}

// @spec
const SPEC: Spec = {
  noun: 'vendor',
  plural: 'vendors',
  fields: [
    { key: 'name', label: 'Name', kind: 'text', required: true },
    {
      key: 'category',
      label: 'Category',
      kind: 'select',
      options: [{ value: 'Software' }, { value: 'Agency' }, { value: 'Hardware' }, { value: 'Services' }],
    },
    { key: 'contact', label: 'Contact', kind: 'person' },
    { key: 'email', label: 'Email', kind: 'email' },
    { key: 'website', label: 'Website', kind: 'url' },
    { key: 'renewal', label: 'Renewal', kind: 'date' },
    { key: 'rating', label: 'Rating', kind: 'rating' },
    { key: 'notes', label: 'Notes', kind: 'longtext' },
  ],
  groupBy: 'category',
  subtitleField: 'category',
  avatar: true,
  sample: [
    { name: 'Linear', category: 'Software', contact: 'Jess Park', email: 'jess@linear.app', website: 'https://linear.app', renewal: '+40', rating: 5, notes: 'Annual plan, 24 seats.' },
    { name: 'Northbeam Studio', category: 'Agency', contact: 'Marco Diaz', email: 'marco@northbeam.co', website: 'https://northbeam.co', renewal: '+12', rating: 4, notes: 'Brand refresh retainer.' },
    { name: 'Dell', category: 'Hardware', contact: 'Account team', email: 'orders@dell.com', website: 'https://dell.com', rating: 3 },
    { name: 'Cleanworks', category: 'Services', contact: 'Ruth Adams', email: 'ruth@cleanworks.com', renewal: '+3', rating: 4, notes: 'Office cleaning, Tuesdays and Fridays.' },
    { name: 'Figma', category: 'Software', contact: 'Support', email: 'support@figma.com', website: 'https://figma.com', renewal: '+95', rating: 5 },
    { name: 'Ledger & Co', category: 'Services', contact: 'Owen Hart', email: 'owen@ledgerco.com', renewal: '-6', rating: 4, notes: 'Bookkeeping; renewal overdue.' },
    { name: 'Pixel Forge', category: 'Agency', contact: 'Lina Chen', email: 'lina@pixelforge.io', website: 'https://pixelforge.io', rating: 3 },
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
      if (typeof v === 'string' && /^[+-]\d+$/.test(v)) {
        const d = new Date()
        d.setDate(d.getDate() + Number(v))
        out[key] = d.toISOString().slice(0, 10)
      }
    }
    return out
  })
}

export default function App() {
  const visvine = useVisvine()
  useSampleRows('items', useMemo(() => resolveDates(SPEC.sample), []))
  const { data, loading } = useCollection<RecordData>('items', { limit: 200 })
  const nameKey = SPEC.fields[0].key
  const rows = useMemo(() => [...((data ?? []) as Row[])].sort((a, b) => String(a.data[nameKey] ?? '').localeCompare(String(b.data[nameKey] ?? ''))), [data, nameKey])
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  useBandAction('new', () => setEditing('new'))

  const group = SPEC.fields.find((f) => f.key === SPEC.groupBy && f.kind === 'select')
  const subtitle = SPEC.fields.find((f) => f.key === SPEC.subtitleField)
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (!filter || !group || r.data[group.key] === filter) &&
        (!q || SPEC.fields.some((f) => String(r.data[f.key] ?? '').toLowerCase().includes(q))),
    )
  }, [rows, search, filter, group])
  const current = rows.find((r) => r.id === selected) ?? shown[0] ?? null

  const save = async (value: RecordData) => {
    if (editing === 'new') {
      const row = await visvine.collections.insert('items', value)
      setSelected(row.id)
    } else if (editing) await visvine.collections.update('items', editing.id, value)
    setEditing(null)
  }
  const remove = async () => {
    if (!editing || editing === 'new') return
    if (!(await visvine.ui.confirm({ title: `Delete ${String(editing.data[nameKey] ?? `this ${SPEC.noun}`)}?`, confirmLabel: 'Delete', destructive: true }))) return
    await visvine.collections.delete('items', editing.id)
    setSelected(null)
    setEditing(null)
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  return (
    <Page>
      {rows.length === 0 ? (
        <RecordsEmpty noun={SPEC.plural} onAdd={() => setEditing('new')} />
      ) : (
        <ListDetail
          items={shown}
          itemKey={(r) => r.id}
          selected={current?.id ?? null}
          onSelect={setSelected}
          listHeader={
            <div className="flex flex-col gap-2">
              <label className="flex h-9 items-center gap-2 rounded-lg bg-surface-subtle px-3 text-fg-muted focus-within:bg-surface focus-within:ring-1 focus-within:ring-line">
                <Icon name="search" size={15} />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.currentTarget.value)}
                  placeholder={`Search ${SPEC.plural}`}
                  aria-label={`Search ${SPEC.plural}`}
                  className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
                />
              </label>
              {group && (
                <Select
                  size="sm"
                  aria-label={group.label}
                  value={filter}
                  onValueChange={setFilter}
                  options={[{ value: '', label: `Every ${group.label.toLowerCase()}` }, ...optionsOf(group).map((o) => ({ value: o.value, label: o.label }))]}
                />
              )}
              <span className="text-xs text-fg-muted">
                {shown.length} {shown.length === 1 ? SPEC.noun : SPEC.plural}
              </span>
            </div>
          }
          renderItem={(r) => (
            <span className="flex min-w-0 items-center gap-3">
              {SPEC.avatar && <PersonAvatar name={String(r.data[nameKey] ?? '?')} size="sm" />}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-fg">{String(r.data[nameKey] ?? 'Untitled')}</span>
                {subtitle && r.data[subtitle.key] ? (
                  <span className="truncate text-xs text-fg-muted">{subtitle.kind === 'select' ? String(r.data[subtitle.key]) : <FieldValue field={subtitle} value={r.data[subtitle.key]} compact />}</span>
                ) : null}
              </span>
            </span>
          )}
          empty={<p className="py-8 text-center text-sm text-fg-muted">No {SPEC.plural} match.</p>}
          detail={
            current && (
              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-4">
                  {SPEC.avatar && <PersonAvatar name={String(current.data[nameKey] ?? '?')} size="md" />}
                  <div className="min-w-0 flex-1">
                    <h1 className="truncate text-xl font-semibold text-fg">{String(current.data[nameKey] ?? 'Untitled')}</h1>
                    {group && current.data[group.key] ? (
                      <div className="mt-1">
                        <FieldValue field={group} value={current.data[group.key]} />
                      </div>
                    ) : null}
                  </div>
                  <Button onClick={() => setEditing(current)}>Edit</Button>
                </div>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                  {SPEC.fields.slice(1).filter((f) => f.key !== group?.key && f.kind !== 'longtext').map((f) => (
                    <div key={f.key} className="min-w-0">
                      <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">{f.label}</dt>
                      <dd className="mt-1 text-sm text-fg">
                        <FieldValue field={f} value={current.data[f.key]} due={f.kind === 'date'} />
                      </dd>
                    </div>
                  ))}
                </dl>
                {SPEC.fields.filter((f) => f.kind === 'longtext' && current.data[f.key]).map((f) => (
                  <section key={f.key} className="border-t border-line-subtle pt-4">
                    <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">{f.label}</h2>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{String(current.data[f.key])}</p>
                  </section>
                ))}
              </div>
            )
          }
        />
      )}
      <RecordDialog
        open={editing !== null}
        title={editing === 'new' ? `New ${SPEC.noun}` : `Edit ${SPEC.noun}`}
        fields={SPEC.fields}
        initial={editing && editing !== 'new' ? editing.data : EMPTY}
        onClose={() => setEditing(null)}
        onSave={save}
        onDelete={editing && editing !== 'new' ? remove : undefined}
        saveLabel={editing === 'new' ? `Add ${SPEC.noun}` : 'Save'}
      />
    </Page>
  )
}

const EMPTY: RecordData = {}
