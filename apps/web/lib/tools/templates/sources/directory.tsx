import { useMemo, useState } from 'react'
import {
  Button,
  FieldValue,
  formatDate,
  HueDot,
  Icon,
  ListDetail,
  optionsOf,
  Page,
  peopleOf,
  PersonAvatar,
  RecordDialog,
  RecordsEmpty,
  Select,
  Spinner,
  useBandAction,
  useCollection,
  useSampleRows,
  SampleData,
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

/** A date that falls due (a renewal, a follow-up) turns red once past; a date that only records (added, joined) never does. */
const DUE = /due|renew|deadline|expir|follow|next|review|until|end/i
const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

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

export default function App() {
  const visvine = useVisvine()
  const samples = useMemo(() => resolveDates(SPEC.sample), [])
  const sampleRows = useSampleRows('items', samples)
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
  const current = shown.find((r) => r.id === selected) ?? shown[0] ?? null
  const rating = SPEC.fields.find((f) => f.kind === 'rating')
  const related = current && group && current.data[group.key] ? rows.filter((r) => r.id !== current.id && r.data[group.key] === current.data[group.key]).slice(0, 6) : []

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
      <SampleData state={sampleRows} />
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
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">{String(r.data[nameKey] ?? 'Untitled')}</span>
                  {rating && r.data[rating.key] ? (
                    <span className="shrink-0 text-xs">
                      <FieldValue field={rating} value={r.data[rating.key]} compact />
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
                  {group && r.data[group.key] ? <HueDot hue={optionsOf(group).find((o) => o.value === r.data[group.key])?.hue} /> : null}
                  <span className="truncate">
                    {[
                      group && r.data[group.key] ? String(r.data[group.key]) : null,
                      subtitle && subtitle.key !== group?.key && r.data[subtitle.key] ? (subtitle.kind === 'date' ? formatDate(r.data[subtitle.key]) : String(r.data[subtitle.key])) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
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
                <dl className="grid grid-cols-2 gap-x-8 gap-y-4 rounded-lg bg-surface-subtle p-4 lg:grid-cols-3">
                  {SPEC.fields.slice(1).filter((f) => f.key !== group?.key && f.kind !== 'longtext' && hasValue(current.data[f.key])).map((f) => (
                    <div key={f.key} className="min-w-0">
                      <dt className="text-xs text-fg-muted">{f.label}</dt>
                      <dd className="mt-1 truncate text-sm font-medium text-fg">
                        <FieldValue field={f} value={current.data[f.key]} due={f.kind === 'date' && DUE.test(f.label)} />
                      </dd>
                    </div>
                  ))}
                </dl>
                {SPEC.fields.filter((f) => f.kind === 'longtext' && current.data[f.key]).map((f) => (
                  <section key={f.key}>
                    <h2 className="text-sm font-semibold text-fg">{f.label}</h2>
                    <Prose label={f.label} text={String(current.data[f.key])} />
                  </section>
                ))}
                {related.length > 0 && (
                  <section className="border-t border-line-subtle pt-4">
                    <h2 className="text-sm font-semibold text-fg">
                      More in {String(current.data[group!.key])}
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {related.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelected(r.id)}
                          className="inline-flex items-center gap-2 rounded-full border border-line-subtle py-1 pl-1 pr-3 text-sm text-fg hover:bg-surface-subtle"
                        >
                          <PersonAvatar name={String(r.data[nameKey] ?? '?')} />
                          {String(r.data[nameKey] ?? 'Untitled')}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
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
        people={peopleOf(SPEC.fields, rows)}
        example={samples[0]}
      />
    </Page>
  )
}

/**
 * Long text as it is meant to be read: lines (or a comma-run of ingredients)
 * as a list — numbered for steps — and anything else as paragraphs.
 */
function Prose({ label, text }: { label: string; text: string }) {
  const steps = /step|method|instruction|direction|how to|process|agenda/i.test(label)
  let items = text.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean)
  if (items.length === 1 && /ingredient|item|material|supplies|list|tools|needs/i.test(label) && text.split(',').length >= 3) items = text.split(',').map((i) => i.trim()).filter(Boolean)
  if (items.length < 2) return <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">{text}</p>
  const List = steps ? 'ol' : 'ul'
  return (
    <List className={`mt-2 flex flex-col gap-1.5 pl-5 text-sm leading-relaxed text-fg-secondary ${steps ? 'list-decimal' : 'list-disc'} marker:text-fg-muted`}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </List>
  )
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** A new entry starts on each select's first option, and a date that records when (Added, Joined) on today. */
const EMPTY: RecordData = Object.fromEntries([
  ...SPEC.fields.filter((field) => field.kind === 'select').map((field) => [field.key, optionsOf(field)[0]?.value ?? '']),
  ...SPEC.fields.filter((field) => field.kind === 'date' && /added|created|logged|joined|since|recorded/i.test(field.label)).map((field) => [field.key, iso(new Date())]),
])
