import { useMemo, useState } from 'react'
import {
  Button,
  FieldValue,
  HueChip,
  Page,
  PersonAvatar,
  Progress,
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
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return iso(d)
}
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const hasFlag = (v: unknown) => v !== false && v !== 0 && filled(v)
const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

const checks = SPEC.fields.filter((f) => f.kind === 'boolean')
const prose = SPEC.fields.filter((f) => f.kind === 'longtext' || f.kind === 'text')
const flagLabel = SPEC.fields.find((f) => f.key === SPEC.flagField)?.label ?? 'Flagged'
const rating = SPEC.fields.find((f) => f.kind === 'rating')
const flagCount = (n: number) => `${n} ${n === 1 ? flagLabel.toLowerCase().replace(/s$/, '') : flagLabel.toLowerCase()}`

/** One person's post: who, then each answer under its own label. The day is the group's heading, never repeated here. */
function EntryView({ entry, onEdit }: { entry: Entry; onEdit?: () => void }) {
  const facts = SPEC.fields.filter((f) => f.kind !== 'boolean' && f.kind !== 'longtext' && f.kind !== 'text' && filled(entry.data[f.key]))
  const flagged = SPEC.flagField && hasFlag(entry.data[SPEC.flagField])
  return (
    <article className="relative flex gap-3 border-b border-line-subtle py-4">
      {flagged && <span aria-hidden className="absolute -left-3 bottom-4 top-4 w-0.5 rounded-full bg-danger" />}
      <PersonAvatar name={entry.data.name} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-fg">{entry.data.name}</span>
          {flagged && <HueChip hue="red">{flagLabel.replace(/s$/, '')}</HueChip>}
          {facts.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 text-xs text-fg-muted">
              {f.label}
              {f.kind === 'rating' ? <span className="font-medium tabular-nums text-fg-secondary">{String(entry.data[f.key])}/5</span> : <FieldValue field={f} value={entry.data[f.key]} compact />}
            </span>
          ))}
          {onEdit && (
            <Button size="sm" variant="ghost" onClick={onEdit} className="ml-auto">
              Edit
            </Button>
          )}
        </div>
        {checks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {checks.map((f) =>
              entry.data[f.key] ? (
                <HueChip key={f.key} hue="green">✓ {f.label}</HueChip>
              ) : (
                <span key={f.key} className="rounded-md border border-line-subtle px-2 py-0.5 text-xs text-fg-subtle">○ {f.label}</span>
              ),
            )}
          </div>
        )}
        {prose.some((f) => filled(entry.data[f.key])) && (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {prose.map((f) =>
              filled(entry.data[f.key]) ? (
                <div key={f.key} className={`min-w-0 ${f.key === SPEC.flagField ? 'sm:col-span-2' : ''}`}>
                  <dt className="text-xs font-medium text-fg-muted">{f.label}</dt>
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

/** People down, the last seven days across: how much of each day's list each person did. */
function HabitGrid({ entries, me }: { entries: Entry[]; me: string }) {
  // From the first day anyone logged, at most a week: a new Tool is not a wall of empty days.
  const first = entries.reduce((min, e) => (e.data.date < min ? e.data.date : min), daysAgo(0))
  const span = Math.min(7, Math.max(3, Math.round((Date.parse(daysAgo(0)) - Date.parse(first)) / 86_400_000) + 1))
  const days = Array.from({ length: span }, (_, i) => daysAgo(span - 1 - i))
  const streak = (name: string) => {
    let n = 0
    for (let i = 0; entries.some((e) => e.data.name === name && e.data.date === daysAgo(i)); i++) n++
    return n
  }
  const people = [...new Set([...entries.map((e) => e.data.name), me])].sort((a, b) => a.localeCompare(b))
  const cell = (name: string, date: string) => entries.find((e) => e.data.name === name && e.data.date === date)
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-fg">Last {span} days</h2>
        <span className="flex items-center gap-1.5 text-xs text-fg-muted">
          None
          <span className="size-3 rounded-sm bg-surface-muted" />
          {[0.25, 0.5, 0.75].map((o) => (
            <span key={o} className="size-3 rounded-sm bg-success" style={{ opacity: 0.25 + 0.75 * o }} />
          ))}
          <span className="size-3 rounded-sm bg-success" />
          All {checks.length}
          <span className="ml-2 size-3 rounded-sm border border-dashed border-line" />
          Not logged
        </span>
      </div>
      <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: `minmax(8rem, 12rem) repeat(${span}, minmax(2rem, 1fr)) 4rem 4rem` }}>
        <span />
        {days.map((d) => (
          <span key={d} className="text-center text-xs text-fg-muted">{d === daysAgo(0) ? 'Today' : new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
        ))}
        <span className="text-right text-xs text-fg-muted">Habits</span>
        <span className="text-right text-xs text-fg-muted">Streak</span>
        {people.map((name) => {
          const shares = days.map((d) => {
            const e = cell(name, d)
            return e ? checks.filter((f) => e.data[f.key]).length / checks.length : null
          })
          const logged = shares.filter((v): v is number => v !== null)
          const done = logged.reduce((a, b) => a + b, 0) * checks.length
          const run = streak(name)
          return [
            <span key={`${name}-n`} className="flex min-w-0 items-center gap-2 text-sm text-fg">
              <PersonAvatar name={name} />
              <span className="truncate">{name}</span>
            </span>,
            ...shares.map((v, i) => (
              <span
                key={`${name}-${i}`}
                title={v === null ? 'Not logged' : `${Math.round(v * checks.length)} of ${checks.length}`}
                className={`mx-auto size-6 rounded ${v === null ? 'border border-dashed border-line' : v === 0 ? 'bg-surface-muted' : 'bg-success'}`}
                // Shade by how many were done: a quarter of the list is a quarter of the green.
                style={v !== null && v > 0 ? { opacity: 0.25 + 0.75 * v } : undefined}
              />
            )),
            <span key={`${name}-r`} className="text-right text-sm tabular-nums text-fg" title={`${Math.round(done)} of ${span * checks.length} done`}>
              {Math.round(done)}
              <span className="text-fg-muted">/{span * checks.length}</span>
            </span>,
            <span key={`${name}-s`} className={`text-right text-sm font-medium tabular-nums ${run >= 3 ? 'text-warning' : 'text-fg-muted'}`}>
              {run > 0 ? `${run} ${run === 1 ? 'day' : 'days'}` : '—'}
            </span>,
          ]
        })}
      </div>
    </section>
  )
}

export default function App() {
  const visvine = useVisvine()
  const [section] = useSection()
  const today = daysAgo(0)
  const samples = useMemo(() => SPEC.sample.map(({ daysAgo: n, ...rest }) => ({ ...rest, date: daysAgo(n) })), [])
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
  if (!people.includes(me)) people.push(me)
  const posted = new Set(entries.filter((e) => e.data.date === today).map((e) => e.data.name))
  const waiting = people.filter((p) => !posted.has(p) && p !== me)
  const flagged = entries.filter((e) => e.data.date === today && flag(e)).length
  const week = entries.filter((e) => e.data.date >= daysAgo(6))
  const todaysAll = entries.filter((e) => e.data.date === today)
  const ratings = (todaysAll.length ? todaysAll : week).map((e) => Number(rating ? e.data[rating.key] : NaN)).filter((n) => Number.isFinite(n) && n > 0)
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null
  const todayChecks = checks.map((f) => ({ field: f, done: entries.filter((e) => e.data.date === today && e.data[f.key]).length }))

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
      title={`${mineToday ? `Your ${SPEC.noun}` : `Post your ${SPEC.noun}`} · ${dayLabel(today)}`}
      fields={SPEC.fields}
      initial={mineToday ? mineToday.data : EMPTY}
      onClose={() => setPosting(false)}
      onSave={save}
      saveLabel={mineToday ? 'Save' : 'Post'}
      example={mineToday ? undefined : SPEC.sample.find((r) => prose.every((f) => r[f.key]))}
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
        {checks.length > 0 && entries.length > 0 && <HabitGrid entries={entries} me={me} />}
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">Earlier days show here.</p>
        ) : (
          history.map(([day, list]) => (
            <section key={day}>
              <h2 className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-line-subtle bg-surface pb-2 pt-1 text-base font-semibold text-fg">
                {dayLabel(day)}
                <span className="font-normal text-fg-muted">
                  {[`${list.length} posted`, SPEC.flagField && list.some(flag) ? flagCount(list.filter(flag).length) : null].filter(Boolean).join(' · ')}
                </span>
              </h2>
              {[...list].sort((a, b) => Number(flag(b)) - Number(flag(a))).map((e) => (
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
        <div className="flex flex-col gap-2">
          <Stat lead label="Posted today" value={`${posted.size} of ${people.length}`} />
          <Progress value={posted.size} max={people.length} hue="green" />
        </div>
        {SPEC.flagField && (
          <Stat label={flagLabel} value={flagged} tone={flagged > 0 ? 'danger' : undefined} hint={flagged ? 'need a hand today' : 'none today'} />
        )}
        {rating && avgRating !== null && <Stat label={`${rating.label} ${todaysAll.length ? 'today' : 'this week'}`} value={`${avgRating.toFixed(1)} / 5`} hint="team average" />}
        {!rating && <Stat label="This week" value={week.length} hint={`of ${people.length * 7} possible posts`} />}
      </StatRow>

      {todayChecks.length > 0 && posted.size > 0 && (
        <section className={`grid grid-cols-2 gap-x-6 gap-y-3 ${todayChecks.length === 3 ? 'sm:grid-cols-3' : todayChecks.length >= 4 ? 'sm:grid-cols-4' : ''}`}>
          {todayChecks.map(({ field, done }) => (
            <Progress key={field.key} value={done} max={posted.size} hue="green" label={`${field.label} · ${done}/${posted.size}`} />
          ))}
        </section>
      )}

      {(waiting.length > 0 || !mineToday) && (
        <section className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-muted">Not posted yet</span>
          {!mineToday && (
            <button
              type="button"
              onClick={() => setPosting(true)}
              className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-2.5 py-0.5 font-medium text-fg hover:opacity-90"
            >
              + Post yours
            </button>
          )}
          {waiting.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle py-0.5 pl-0.5 pr-2.5">
              <PersonAvatar name={p} />
              <span className="text-fg-secondary">{p}</span>
            </span>
          ))}
        </section>
      )}

      <section>
        <h2 className="border-b border-line-subtle pb-2 text-sm font-semibold text-fg">{dayLabel(today)}</h2>
        {mineToday && <EntryView entry={mineToday} onEdit={() => setPosting(true)} />}
        {todays.map((e) => (
          <EntryView key={e.id} entry={e} />
        ))}
      </section>

      {dialog}
    </Page>
  )
}

const EMPTY: RecordData = {}
