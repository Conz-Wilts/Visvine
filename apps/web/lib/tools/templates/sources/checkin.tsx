import { useMemo, useState } from 'react'
import {
  Button,
  FieldValue,
  formatDate,
  HueChip,
  Page,
  PersonAvatar,
  RecordDialog,
  Spinner,
  Stat,
  StatRow,
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
const hasFlag = (v: unknown) => v !== false && v !== 0 && filled(v)
const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

function EntryView({ entry, onEdit }: { entry: Entry; onEdit?: () => void }) {
  const checks = SPEC.fields.filter((f) => f.kind === 'boolean')
  const prose = SPEC.fields.filter((f) => f.kind === 'longtext' || f.kind === 'text')
  const facts = SPEC.fields.filter((f) => f.kind !== 'boolean' && f.kind !== 'longtext' && f.kind !== 'text' && filled(entry.data[f.key]))
  const flagged = SPEC.flagField && hasFlag(entry.data[SPEC.flagField])
  return (
    <article className="flex gap-3 border-b border-line-subtle py-4">
      <PersonAvatar name={entry.data.name} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg">{entry.data.name}</span>
          <span className="text-xs text-fg-muted">{formatDate(entry.data.date)}</span>
          {flagged && <HueChip hue="red">{SPEC.fields.find((f) => f.key === SPEC.flagField)?.label ?? 'Flagged'}</HueChip>}
          {facts.map((f) => (
            <span key={f.key} className="text-xs text-fg-muted">
              <FieldValue field={f} value={entry.data[f.key]} compact />
            </span>
          ))}
          {onEdit && (
            <Button size="sm" variant="ghost" onClick={onEdit} className="ml-auto">
              Edit update
            </Button>
          )}
        </div>
        {checks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {checks.map((f) => (entry.data[f.key] ? <HueChip key={f.key} hue="green">✓ {f.label}</HueChip> : <HueChip key={f.key}>{f.label}</HueChip>))}
          </div>
        )}
        {prose.some((f) => filled(entry.data[f.key])) && (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {prose.map((f) =>
              filled(entry.data[f.key]) ? (
                <div key={f.key} className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">{f.label}</dt>
                  <dd className={`mt-0.5 whitespace-pre-wrap text-sm ${f.key === SPEC.flagField ? 'font-medium text-danger' : 'text-fg'}`}>{String(entry.data[f.key])}</dd>
                </div>
              ) : null,
            )}
          </dl>
        )}
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
  const sampleRows = useSampleRows('entries', samples)
  const { data, loading } = useCollection<Entry['data']>('entries', { order: 'desc', limit: 200 })
  const entries = (data ?? []) as Entry[]
  const [posting, setPosting] = useState(false)

  const me = visvine.viewer.name
  const mineToday = entries.find((e) => e.mine && e.data.date === today && e.data.name === me)
  useBandAction('post', () => setPosting(true))

  const flag = (e: Entry) => Boolean(SPEC.flagField && hasFlag(e.data[SPEC.flagField]))
  const todays = entries.filter((e) => e.data.date === today && e !== mineToday).sort((a, b) => Number(flag(b)) - Number(flag(a)))
  const people = [...new Set(entries.map((e) => e.data.name))]
  const posted = new Set(entries.filter((e) => e.data.date === today).map((e) => e.data.name))
  const waiting = people.filter((p) => !posted.has(p) && p !== me)
  const flagged = entries.filter((e) => e.data.date === today && flag(e)).length

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

  const history = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of entries) if (e.data.date !== today) map.set(e.data.date, [...(map.get(e.data.date) ?? []), e])
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [entries, today])

  const save = async (value: RecordData) => {
    if (mineToday) await visvine.collections.update('entries', mineToday.id, { ...mineToday.data, ...value })
    else await visvine.collections.insert('entries', { ...value, name: me, date: today })
    setPosting(false)
    void visvine.ui.toast(`${title(SPEC.noun)} posted`, 'success')
  }

  const dialog = (
    <RecordDialog
      open={posting}
      title={mineToday ? `Your ${SPEC.noun}` : `Post your ${SPEC.noun}`}
      fields={SPEC.fields}
      initial={mineToday ? mineToday.data : EMPTY}
      onClose={() => setPosting(false)}
      onSave={save}
      saveLabel={mineToday ? 'Save' : 'Post'}
    />
  )

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
      <SampleData state={sampleRows} />
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">Earlier days show here.</p>
        ) : (
          history.map(([day, list]) => (
            <section key={day}>
              <h2 className="border-b border-line-subtle pb-2 text-sm font-semibold text-fg">
                {formatDate(day)} <span className="font-normal text-fg-muted">· {list.length}</span>
              </h2>
              {list.map((e) => (
                <EntryView key={e.id} entry={e} />
              ))}
            </section>
          ))
        )}
        {dialog}
      </Page>
    )
  }

  return (
    <Page width="normal">
      <SampleData state={sampleRows} />
      <StatRow>
        <Stat lead label="Posted today" value={posted.size} hint={`of ${Math.max(people.length, posted.size)} people`} />
        <Stat label="Your streak" value={streak} hint={streak === 1 ? 'day' : 'days'} />
        {SPEC.flagField && (
          <Stat label={SPEC.fields.find((f) => f.key === SPEC.flagField)?.label ?? 'Flagged'} value={flagged} tone={flagged > 0 ? 'danger' : undefined} hint={flagged ? 'today' : undefined} />
        )}
      </StatRow>

      {mineToday ? (
        <EntryView entry={mineToday} onEdit={() => setPosting(true)} />
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-subtle px-4 py-3">
          <span className="text-sm text-fg">You have not posted today.</span>
          <Button variant="primary" onClick={() => setPosting(true)}>
            Post {SPEC.noun}
          </Button>
        </div>
      )}

      <section>
        {todays.map((e) => (
          <EntryView key={e.id} entry={e} />
        ))}
      </section>

      {waiting.length > 0 && (
        <section className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <span>Not posted yet</span>
          {waiting.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-surface-subtle py-0.5 pl-0.5 pr-2.5">
              <PersonAvatar name={p} />
              <span className="text-fg-secondary">{p}</span>
            </span>
          ))}
        </section>
      )}
      {dialog}
    </Page>
  )
}

const EMPTY: RecordData = {}
