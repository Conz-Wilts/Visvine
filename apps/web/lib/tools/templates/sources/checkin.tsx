import { useMemo, useState } from 'react'
import {
  Avatar,
  Button,
  FieldValue,
  formatDate,
  Page,
  RecordForm,
  Spinner,
  Stat,
  StatRow,
  missingRequired,
  useCollection,
  useSampleRows,
  useSection,
  useVisvine,
  type FieldDef,
  type RecordData,
} from '@visvine/tool-kit'

interface Spec {
  /** What one entry is called: "check-in", "update", "entry". */
  noun: string
  /** What the form asks each person, in order. */
  fields: FieldDef[]
  /** A field whose being filled is worth flagging (blockers) — shown as a count. */
  flagField?: string
  /** Sample entries from other people, days before today in `daysAgo`. */
  sample: Array<RecordData & { name: string; daysAgo: number }>
}

// @spec
const SPEC: Spec = {
  noun: 'check-in',
  fields: [
    { key: 'yesterday', label: 'Yesterday', kind: 'longtext', required: true },
    { key: 'today', label: 'Today', kind: 'longtext', required: true },
    { key: 'blockers', label: 'Blockers', kind: 'longtext' },
    { key: 'mood', label: 'Mood', kind: 'rating' },
  ],
  flagField: 'blockers',
  sample: [
    { name: 'Ana Silva', daysAgo: 0, yesterday: 'Shipped the pricing page copy.', today: 'Review onboarding emails with Sam.', mood: 4 },
    { name: 'Sam Lee', daysAgo: 0, yesterday: 'Fixed the CSV import bug.', today: 'Start on the billing migration.', blockers: 'Need staging DB access.', mood: 3 },
    { name: 'Priya Nair', daysAgo: 0, yesterday: 'Three customer calls.', today: 'Write up call notes, plan Q4 interviews.', mood: 5 },
    { name: 'Tom Okafor', daysAgo: 1, yesterday: 'Design review for mobile nav.', today: 'Prototype the new settings screen.', mood: 4 },
    { name: 'Ana Silva', daysAgo: 1, yesterday: 'Drafted pricing page copy.', today: 'Ship it.', mood: 4 },
    { name: 'Sam Lee', daysAgo: 1, yesterday: 'Investigated import failures.', today: 'Fix the CSV import bug.', mood: 3 },
    { name: 'Priya Nair', daysAgo: 2, yesterday: 'Synthesised survey results.', today: 'Customer calls.', blockers: 'Waiting on legal for the NDA.', mood: 3 },
  ],
}
// @end-spec

type Entry = { id: string; mine: boolean; data: RecordData & { name: string; date: string } }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function EntryView({ entry }: { entry: Entry }) {
  return (
    <article className="flex gap-3 border-b border-line-subtle py-4">
      <Avatar name={entry.data.name} size="sm" fallback="initials" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-fg">{entry.data.name}</span>
          <span className="text-xs text-fg-muted">{formatDate(entry.data.date)}</span>
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SPEC.fields.map((f) =>
            entry.data[f.key] === undefined || entry.data[f.key] === '' || entry.data[f.key] === null ? null : (
              <div key={f.key} className={f.kind === 'longtext' ? 'min-w-0' : 'min-w-0 sm:col-span-2'}>
                <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">{f.label}</dt>
                <dd className={`mt-0.5 text-sm ${f.key === SPEC.flagField ? 'text-danger' : 'text-fg'}`}>
                  {f.kind === 'longtext' ? <span className="whitespace-pre-wrap">{String(entry.data[f.key])}</span> : <FieldValue field={f} value={entry.data[f.key]} />}
                </dd>
              </div>
            ),
          )}
        </dl>
      </div>
    </article>
  )
}

export default function App() {
  const visvine = useVisvine()
  const [section] = useSection()
  const today = iso(new Date())
  const samples = useMemo(
    () =>
      SPEC.sample.map(({ daysAgo, ...rest }) => {
        const d = new Date()
        d.setDate(d.getDate() - daysAgo)
        return { ...rest, date: iso(d) }
      }),
    [],
  )
  useSampleRows('entries', samples)
  const { data, loading } = useCollection<Entry['data']>('entries', { order: 'desc', limit: 200 })
  const entries = (data ?? []) as Entry[]
  const [draft, setDraft] = useState<RecordData>({})
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  const me = visvine.viewer.name
  const mineToday = entries.find((e) => e.mine && e.data.date === today && e.data.name === me)
  const todays = entries.filter((e) => e.data.date === today)
  const people = new Set(entries.map((e) => e.data.name))
  const flagged = SPEC.flagField ? todays.filter((e) => String(e.data[SPEC.flagField!] ?? '').trim()).length : 0

  const streak = useMemo(() => {
    const days = new Set(entries.filter((e) => e.mine && e.data.name === me).map((e) => e.data.date))
    let n = 0
    const d = new Date()
    if (!days.has(iso(d))) d.setDate(d.getDate() - 1)
    while (days.has(iso(d))) {
      n++
      d.setDate(d.getDate() - 1)
    }
    return n
  }, [entries, me])

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of entries) map.set(e.data.date, [...(map.get(e.data.date) ?? []), e])
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [entries])

  const submit = async () => {
    const missing = missingRequired(SPEC.fields, draft)
    setErrors(missing)
    if (missing.length) return
    setBusy(true)
    try {
      if (mineToday) await visvine.collections.update('entries', mineToday.id, { ...mineToday.data, ...draft })
      else await visvine.collections.insert('entries', { ...draft, name: me, date: today })
      setDraft({})
      setEditing(false)
      void visvine.ui.toast(`${title(SPEC.noun)} posted`, 'success')
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

  if (section === 'history') {
    return (
      <Page width="normal">
        {byDay.map(([day, list]) => (
          <section key={day}>
            <h2 className="border-b border-line-subtle pb-2 text-sm font-semibold text-fg">
              {day === today ? 'Today' : formatDate(day)} <span className="font-normal text-fg-muted">· {list.length}</span>
            </h2>
            {list.map((e) => (
              <EntryView key={e.id} entry={e} />
            ))}
          </section>
        ))}
      </Page>
    )
  }

  return (
    <Page width="normal">
      <StatRow>
        <Stat label="Today" value={`${todays.length}`} hint={`of ${people.size} people`} />
        <Stat label="Your streak" value={streak} hint={streak === 1 ? 'day' : 'days'} />
        {SPEC.flagField && <Stat label={SPEC.fields.find((f) => f.key === SPEC.flagField)?.label ?? 'Flagged'} value={flagged} />}
      </StatRow>

      {!mineToday || editing ? (
        <section className="flex flex-col gap-4 border-b border-line-subtle pb-6">
          <h2 className="text-base font-semibold text-fg">Your {SPEC.noun}</h2>
          <RecordForm fields={SPEC.fields} value={draft} onChange={setDraft} errors={errors} />
          <div className="flex justify-end gap-2">
            {editing && <Button onClick={() => setEditing(false)}>Cancel</Button>}
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              Post
            </Button>
          </div>
        </section>
      ) : (
        <div className="flex items-center justify-between text-sm text-fg-muted">
          <span>You posted today.</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(mineToday.data)
              setEditing(true)
            }}
          >
            Edit
          </Button>
        </div>
      )}

      <section>
        {todays.map((e) => (
          <EntryView key={e.id} entry={e} />
        ))}
      </section>
    </Page>
  )
}
