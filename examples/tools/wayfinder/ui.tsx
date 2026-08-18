// The interface half of the Wayfinder Tool. Compiled server-side on every write
// (lib/tools/compile.ts): only react and @visvine/tool-kit are importable, and
// the default export is what the frame runtime mounts.
//
// Everything it reads or writes goes through data.js, which is the one place
// that knows the note layout — see index.md. This file only draws.
//
// Three surfaces come out of one component, chosen by `visvine.subject`:
//   subject === null                → the rail page: pick or create a project
//   subject.type wayfinder-project  → that project's plan + board
//   subject.type wayfinder-task     → one task, on its own page
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Stack,
  Textarea,
  useQuery,
  useVisvine,
} from '@visvine/tool-kit'
import type { ChipTone } from '@visvine/tool-kit'

const PROJECT_TYPE = 'wayfinder-project'
const TASK_TYPE = 'wayfinder-task'

/** How many times the board re-reads a task note after a run is queued. */
const OUTCOME_POLLS = 10
const OUTCOME_POLL_MS = 6000

const STATUSES = ['todo', 'doing', 'done', 'failed'] as const
const SIZES = ['', 'xs', 's', 'm', 'l', 'xl'] as const

type Status = (typeof STATUSES)[number]

interface Wave {
  n: number
  title: string
}

interface RunRow {
  id: string
  status: string
  at: string
  detail: string
}

interface ProjectDoc {
  name: string
  path: string
  title: string
  goal: string
  status: string
  waves: Wave[]
  brief: string
  plan: string
}

interface TaskDoc {
  path: string
  id: string
  title: string
  status: Status
  size: string
  wave: number
  depends_on: string[]
  touches: string[]
  agent: string
  run: RunRow | null
  task: string
  outcome: string
}

interface BoardData {
  project: ProjectDoc
  tasks: TaskDoc[]
  truncated: boolean
}

interface ProjectRow {
  name: string
  path: string
  title: string
  tasks: number
  updatedAt: string
}

interface BriefResult {
  path: string
  name: string
  status: 'present' | 'written' | 'refused'
  reason: string
  text: string
}

interface RunResult {
  task: TaskDoc
  brief: BriefResult
  run: RunRow
}

const STATUS_TONE: Record<Status, ChipTone> = {
  todo: 'neutral',
  doing: 'info',
  done: 'accent',
  failed: 'danger',
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function notePath(path: string): string {
  return `/directory/note/${path}`
}

/** The project a `harness/<project>/…` path belongs to, or null. */
function projectOfPath(path: string): string | null {
  const m = /^harness\/([a-z0-9][a-z0-9-]*)\//.exec(path)
  return m ? m[1] : null
}

function typeOf(subject: { type?: string | null } | null): string {
  return (subject?.type ?? '').trim().toLowerCase()
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** The next unused id on a board, keeping the harness's own zero-padded shape. */
function nextTaskId(tasks: TaskDoc[]): string {
  let highest = 0
  for (const task of tasks) {
    const n = Number(task.id)
    if (Number.isFinite(n) && n > highest) highest = Math.floor(n)
  }
  return String(highest + 1).padStart(3, '0')
}

// ── shared bits ───────────────────────────────────────────────────────────────

function ErrorCard({ title, children }: { title: string; children: string }) {
  return (
    <Banner tone="danger" title={title}>
      {children}
    </Banner>
  )
}

/**
 * Said once at the top when the space is missing something the Tool declared.
 * A board whose Run button cannot work should say so rather than fail per click.
 */
function DegradedBanner() {
  const visvine = useVisvine()
  const degraded = visvine.degraded
  if (!degraded) return null
  const missing = degraded.missing
  const lines: string[] = []
  if (missing.agents.length > 0) {
    lines.push(
      `No agent here matches ${missing.agents.join(', ')} — Run will write the brief it needs and then be refused until a space admin activates it.`,
    )
  }
  if (missing.types.length > 0) {
    lines.push(`This space has no ${missing.types.join(', ')} type, so project and task notes open as plain notes.`)
  }
  if (missing.connectors.length > 0) {
    lines.push(`No connector here matches ${missing.connectors.join(', ')}.`)
  }
  if (lines.length === 0) return null
  return (
    <Banner tone="warn" title="Running degraded">
      {lines.join(' ')}
    </Banner>
  )
}

function Meta({ task }: { task: TaskDoc }) {
  return (
    <Stack direction="row" gap="sm" wrap>
      <Chip tone={STATUS_TONE[task.status]}>{task.status}</Chip>
      {task.size ? <Chip>{task.size}</Chip> : null}
      <Chip tone="neutral">wave {task.wave}</Chip>
      {task.depends_on.length > 0 ? <Chip tone="info">needs {task.depends_on.join(', ')}</Chip> : null}
    </Stack>
  )
}

function RunSummary({ run }: { run: RunRow | null }) {
  if (!run || !run.status) return null
  const tone: ChipTone = run.status === 'queued' ? 'info' : run.status === 'refused' ? 'danger' : 'warn'
  return (
    <Stack direction="row" gap="sm" wrap>
      <Chip tone={tone}>run {run.status}</Chip>
      {run.at ? <span style={{ fontSize: 12, color: 'var(--vv-text-muted)' }}>{run.at.slice(0, 16).replace('T', ' ')}</span> : null}
      {run.detail ? <span style={{ fontSize: 12, color: 'var(--vv-text-muted)' }}>{run.detail}</span> : null}
    </Stack>
  )
}

/**
 * What came back from a Run. The interesting case is `refused`: a Tool may not
 * write an agent brief, so the board hands the person the exact note to save.
 */
function RunOutcome({ result, onDismiss }: { result: RunResult; onDismiss: () => void }) {
  if (result.brief.status === 'refused') {
    return (
      <Banner tone="warn" title="Visvine will not let a tool write an agent brief" action={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>
        <Stack gap="sm">
          <span>
            {result.brief.reason} Save this note at <code>{result.brief.path}</code> yourself, ask an admin to
            activate it, and Run will dispatch it.
          </span>
          <pre
            style={{
              margin: 0,
              padding: 10,
              maxHeight: 220,
              overflow: 'auto',
              fontSize: 12,
              background: 'var(--vv-surface-2)',
              border: '1px solid var(--vv-border)',
              borderRadius: 'var(--vv-radius)',
              color: 'var(--vv-text)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {result.brief.text}
          </pre>
        </Stack>
      </Banner>
    )
  }
  if (result.run.status === 'queued') {
    return (
      <Banner tone="success" title={`Run queued for ${result.brief.name}`} action={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>
        {`Run ${result.run.id}. The outcome lands on the task note under ## Outcome.`}
      </Banner>
    )
  }
  return (
    <Banner tone="danger" title={`${result.brief.name} did not start`} action={<Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>
      {result.run.detail || 'The run was refused.'}
    </Banner>
  )
}

// ── the rail page: every project in the space ─────────────────────────────────

function ProjectList({ onOpen }: { onOpen: (project: string) => void }) {
  const visvine = useVisvine()
  const projects = useQuery(() => visvine.data.call<{ projects: ProjectRow[] }>('listProjects'), [])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const slug = slugify(name)
      const created = await visvine.data.call<{ project: ProjectDoc }>('createProject', {
        name: slug,
        title: name.trim(),
        goal: goal.trim(),
      })
      setCreating(false)
      setName('')
      setGoal('')
      onOpen(created.project.name)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap="lg">
      <PageHeader
        title="Wayfinder"
        description="A goal, its waves and its task board — kept as context notes in this space."
        actions={
          <Button variant={creating ? 'secondary' : 'primary'} onClick={() => setCreating(!creating)}>
            {creating ? 'Cancel' : 'New project'}
          </Button>
        }
      />
      <DegradedBanner />
      {error ? <ErrorCard title="Could not create that project">{error}</ErrorCard> : null}

      {creating ? (
        <Card title="New project">
          <Stack gap="md">
            <Field label="Name" hint={name ? `harness/${slugify(name)}/project.md` : 'Becomes a folder under harness/'}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="User-created Tools" />
            </Field>
            <Field label="Goal" hint="One line — what finished looks like.">
              <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Let members build anything as a Tool." />
            </Field>
            <div>
              <Button variant="primary" disabled={busy || slugify(name) === ''} onClick={create}>
                {busy ? 'Creating…' : 'Create project'}
              </Button>
            </div>
          </Stack>
        </Card>
      ) : null}

      {projects.loading ? <Spinner size="lg" /> : null}
      {projects.error ? <ErrorCard title="Could not list projects">{projects.error.message}</ErrorCard> : null}
      {projects.data && projects.data.projects.length === 0 && !creating ? (
        <EmptyState
          title="No projects yet"
          description="A project is one goal, its waves and the tasks under them. Create one to start a board."
          action={<Button variant="primary" onClick={() => setCreating(true)}>New project</Button>}
        />
      ) : null}

      {(projects.data?.projects ?? []).map((row) => (
        <Card
          key={row.path}
          title={row.title}
          actions={
            <Stack direction="row" gap="sm">
              <Chip>{`${row.tasks} task${row.tasks === 1 ? '' : 's'}`}</Chip>
              <Button size="sm" onClick={() => onOpen(row.name)}>
                Open
              </Button>
            </Stack>
          }
        >
          <span style={{ fontSize: 12, color: 'var(--vv-text-muted)' }}>{row.path}</span>
        </Card>
      ))}
    </Stack>
  )
}

// ── the plan panel ────────────────────────────────────────────────────────────

function PlanPanel({
  project,
  onSaved,
}: {
  project: ProjectDoc
  onSaved: () => void
}) {
  const visvine = useVisvine()
  const [editing, setEditing] = useState(false)
  const [goal, setGoal] = useState(project.goal)
  const [brief, setBrief] = useState(project.brief)
  const [waveTitles, setWaveTitles] = useState<Wave[]>(project.waves)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function start() {
    setGoal(project.goal)
    setBrief(project.brief)
    setWaveTitles(project.waves)
    setError(null)
    setEditing(true)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await visvine.data.call('saveProject', {
        project: project.name,
        patch: { goal, brief, waves: waveTitles },
      })
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  function addWave() {
    const n = waveTitles.reduce((highest, wave) => Math.max(highest, wave.n), 0) + 1
    setWaveTitles([...waveTitles, { n, title: `Wave ${n}` }])
  }

  if (!editing) {
    return (
      <Card
        title="Plan"
        actions={
          <Button size="sm" variant="secondary" onClick={start}>
            Edit
          </Button>
        }
      >
        <Stack gap="md">
          {error ? <ErrorCard title="Could not save the plan">{error}</ErrorCard> : null}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vv-text-secondary)' }}>Goal</div>
            <div>{project.goal || <span style={{ color: 'var(--vv-text-muted)' }}>Not written yet.</span>}</div>
          </div>
          {project.brief ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--vv-text-secondary)' }}>Brief</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{project.brief}</div>
            </div>
          ) : null}
          <Stack direction="row" gap="sm" wrap>
            {project.waves.map((wave) => (
              <Chip key={wave.n}>{`${wave.n} · ${wave.title || 'untitled'}`}</Chip>
            ))}
          </Stack>
        </Stack>
      </Card>
    )
  }

  return (
    <Card title="Plan">
      <Stack gap="md">
        {error ? <ErrorCard title="Could not save the plan">{error}</ErrorCard> : null}
        <Field label="Goal" hint="Written to the note's frontmatter and its ## Goal section.">
          <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <Field label="Brief" hint="The ## Brief section of the project note.">
          <Textarea value={brief} rows={6} onChange={(e) => setBrief(e.target.value)} />
        </Field>
        <Field label="Waves" hint="One board column each.">
          <Stack gap="sm">
            {waveTitles.map((wave, index) => (
              <Stack key={wave.n} direction="row" gap="sm">
                <Chip>{wave.n}</Chip>
                <Input
                  value={wave.title}
                  onChange={(e) => {
                    const next = [...waveTitles]
                    next[index] = { n: wave.n, title: e.target.value }
                    setWaveTitles(next)
                  }}
                />
              </Stack>
            ))}
            <div>
              <Button size="sm" variant="ghost" onClick={addWave}>
                Add wave
              </Button>
            </div>
          </Stack>
        </Field>
        <Stack direction="row" gap="sm">
          <Button variant="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save plan'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </Stack>
      </Stack>
    </Card>
  )
}

// ── one card ──────────────────────────────────────────────────────────────────

interface CardActions {
  save: (path: string, patch: Record<string, unknown>) => Promise<void>
  move: (path: string, wave: number) => Promise<void>
  run: (task: TaskDoc) => Promise<void>
  busyPath: string | null
}

function TaskCard({
  task,
  waves,
  actions,
}: {
  task: TaskDoc
  waves: Wave[]
  actions: CardActions
}) {
  const visvine = useVisvine()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task)
  const busy = actions.busyPath === task.path

  function start() {
    setDraft(task)
    setEditing(true)
  }

  async function save() {
    await actions.save(task.path, {
      title: draft.title,
      status: draft.status,
      size: draft.size,
      depends_on: draft.depends_on,
      touches: draft.touches,
      task: draft.task,
    })
    setEditing(false)
  }

  const frame: CSSProperties = {
    background: 'var(--vv-surface)',
    border: '1px solid var(--vv-border)',
    borderRadius: 'var(--vv-radius)',
    padding: 10,
    opacity: busy ? 0.6 : 1,
  }

  if (editing) {
    return (
      <div style={frame}>
        <Stack gap="sm">
          <Field label="Title">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Stack direction="row" gap="sm">
            <Select
              value={draft.status}
              options={STATUSES.map((value) => ({ value, label: value }))}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}
            />
            <Select
              value={draft.size}
              options={SIZES.map((value) => ({ value, label: value || 'size' }))}
              onChange={(e) => setDraft({ ...draft, size: e.target.value })}
            />
          </Stack>
          <Field label="Depends on" hint="Task ids, comma separated.">
            <Input
              value={draft.depends_on.join(', ')}
              onChange={(e) => setDraft({ ...draft, depends_on: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
          <Field label="Touches" hint="Paths this task may change.">
            <Input
              value={draft.touches.join(', ')}
              onChange={(e) => setDraft({ ...draft, touches: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
          <Field label="Task" hint="The ## Task section — what an agent brief is written from.">
            <Textarea value={draft.task} rows={5} onChange={(e) => setDraft({ ...draft, task: e.target.value })} />
          </Field>
          <Stack direction="row" gap="sm">
            <Button size="sm" variant="primary" disabled={busy} onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      </div>
    )
  }

  return (
    <div style={frame}>
      <Stack gap="sm">
        <div style={{ fontWeight: 600 }}>
          <span style={{ color: 'var(--vv-text-muted)', fontWeight: 400 }}>{task.id} </span>
          {task.title}
        </div>
        <Meta task={task} />
        <RunSummary run={task.run} />
        {task.outcome ? <Chip tone="accent">outcome recorded</Chip> : null}
        <Stack direction="row" gap="sm" wrap>
          <Button size="sm" variant="ghost" disabled={busy} onClick={start}>
            Edit
          </Button>
          {task.status !== 'done' ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => actions.save(task.path, { status: 'done' })}>
              Done
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => actions.run(task)}>
            Run
          </Button>
          <Button size="sm" variant="ghost" onClick={() => visvine.navigate(notePath(task.path))}>
            Open
          </Button>
        </Stack>
        <Select
          value={String(task.wave)}
          disabled={busy}
          options={waves.map((wave) => ({ value: String(wave.n), label: `wave ${wave.n}${wave.title ? ` · ${wave.title}` : ''}` }))}
          onChange={(e) => actions.move(task.path, Number(e.target.value))}
        />
      </Stack>
    </div>
  )
}

// ── the board ─────────────────────────────────────────────────────────────────

function AddTask({
  project,
  wave,
  nextId,
  onAdded,
}: {
  project: string
  wave: number
  nextId: string
  onAdded: () => void
}) {
  const visvine = useVisvine()
  const [open, setOpen] = useState(false)
  const [id, setId] = useState(nextId)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true)
    setError(null)
    try {
      await visvine.data.call('saveTask', {
        project,
        patch: { id: id.trim(), title: title.trim(), wave, status: 'todo' },
      })
      setOpen(false)
      setTitle('')
      onAdded()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setId(nextId)
          setOpen(true)
        }}
      >
        + Add task
      </Button>
    )
  }

  return (
    <Stack gap="sm">
      {error ? <ErrorCard title="Could not add that task">{error}</ErrorCard> : null}
      <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="id" />
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this task?" />
      <Stack direction="row" gap="sm">
        <Button size="sm" variant="primary" disabled={busy || !id.trim() || !title.trim()} onClick={add}>
          Add
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  )
}

function Board({ data, reload }: { data: BoardData; reload: () => void }) {
  const visvine = useVisvine()
  const project = data.project.name
  const tasks = data.tasks
  const [error, setError] = useState<string | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [pollsLeft, setPollsLeft] = useState(0)

  // A bounded poll, and only after a run was actually queued: an agent run takes
  // minutes and its outcome arrives on the task note, so the board re-reads it a
  // few times and then stops rather than watching forever.
  const waitingFor = runResult?.run.status === 'queued' ? runResult.task.path : null
  const landed = waitingFor ? (tasks.find((task) => task.path === waitingFor)?.outcome ?? '') !== '' : false
  useEffect(() => {
    if (pollsLeft <= 0 || !waitingFor || landed) return
    const timer = setTimeout(() => {
      setPollsLeft((left) => left - 1)
      reload()
    }, OUTCOME_POLL_MS)
    return () => clearTimeout(timer)
  }, [pollsLeft, waitingFor, landed, reload])

  async function withTask(path: string, run: () => Promise<unknown>) {
    setBusyPath(path)
    setError(null)
    try {
      await run()
      reload()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusyPath(null)
    }
  }

  const actions: CardActions = {
    busyPath,
    save: (path, patch) =>
      withTask(path, () => visvine.data.call('saveTask', { project, path, patch })),
    move: (path, wave) => withTask(path, () => visvine.data.call('moveTask', { path, wave })),
    run: (task) =>
      withTask(task.path, async () => {
        const result = await visvine.data.call<RunResult>('runTask', { path: task.path })
        setRunResult(result)
        setPollsLeft(result.run.status === 'queued' ? OUTCOME_POLLS : 0)
      }),
  }

  const waves = data.project.waves.length > 0 ? data.project.waves : [{ n: 1, title: '' }]
  const nextId = nextTaskId(tasks)

  return (
    <Stack gap="md">
      {error ? <ErrorCard title="That did not save">{error}</ErrorCard> : null}
      {runResult ? <RunOutcome result={runResult} onDismiss={() => setRunResult(null)} /> : null}
      {data.truncated ? (
        <Banner tone="warn" title="This board is truncated">
          Only the first tasks in this project were read. Split it into more projects, or narrow the plan.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', alignItems: 'flex-start', paddingBottom: 6 }}>
        {waves.map((wave) => {
          const column = tasks.filter((task) => task.wave === wave.n)
          return (
            <div
              key={wave.n}
              style={{
                flex: '0 0 280px',
                background: 'var(--vv-surface-2)',
                border: '1px solid var(--vv-border)',
                borderRadius: 'var(--vv-radius-lg)',
                padding: 10,
              }}
            >
              <Stack gap="sm">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{`Wave ${wave.n}`}</span>
                  <span style={{ fontSize: 12, color: 'var(--vv-text-muted)' }}>{wave.title}</span>
                </div>
                {column.map((task) => (
                  <TaskCard key={task.path} task={task} waves={waves} actions={actions} />
                ))}
                {column.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--vv-text-muted)' }}>Nothing here yet.</span>
                ) : null}
                <AddTask project={project} wave={wave.n} nextId={nextId} onAdded={reload} />
              </Stack>
            </div>
          )
        })}
      </div>
    </Stack>
  )
}

function ProjectView({ project, onBack }: { project: string; onBack?: () => void }) {
  const visvine = useVisvine()
  const board = useQuery(() => visvine.data.call<BoardData>('loadProject', { project }), [project])

  if (board.loading && !board.data) return <Spinner size="lg" />
  if (board.error) return <ErrorCard title="Could not open that project">{board.error.message}</ErrorCard>
  if (!board.data) return null

  const doc = board.data.project
  return (
    <Stack gap="lg">
      <PageHeader
        title={doc.title}
        description={doc.goal || doc.path}
        actions={
          <Stack direction="row" gap="sm">
            <Chip tone={doc.status === 'done' ? 'accent' : 'info'}>{doc.status}</Chip>
            {onBack ? (
              <Button size="sm" variant="ghost" onClick={onBack}>
                All projects
              </Button>
            ) : null}
          </Stack>
        }
      />
      <DegradedBanner />
      <PlanPanel project={doc} onSaved={board.reload} />
      <Board data={board.data} reload={board.reload} />
    </Stack>
  )
}

// ── one task, on its own page ─────────────────────────────────────────────────

function TaskView({ path }: { path: string }) {
  const visvine = useVisvine()
  const loaded = useQuery(
    () => visvine.data.call<{ task: TaskDoc; project: ProjectDoc | null }>('loadTask', { path }),
    [path],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<RunResult | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      setRunResult(await visvine.data.call<RunResult>('runTask', { path }))
      loaded.reload()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  async function markDone() {
    setBusy(true)
    setError(null)
    try {
      const project = projectOfPath(path)
      await visvine.data.call('saveTask', { project, path, patch: { status: 'done' } })
      loaded.reload()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (loaded.loading && !loaded.data) return <Spinner size="lg" />
  if (loaded.error) return <ErrorCard title="Could not open this task">{loaded.error.message}</ErrorCard>
  if (!loaded.data) return null

  const task = loaded.data.task
  const project = loaded.data.project

  return (
    <Stack gap="lg">
      <PageHeader
        title={`${task.id} · ${task.title}`}
        description={project ? `${project.title} — wave ${task.wave}` : `wave ${task.wave}`}
        actions={
          <Stack direction="row" gap="sm">
            {task.status !== 'done' ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={markDone}>
                Mark done
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" disabled={busy} onClick={run}>
              Run
            </Button>
            {project ? (
              <Button size="sm" onClick={() => visvine.navigate(notePath(project.path))}>
                Board
              </Button>
            ) : null}
          </Stack>
        }
      />
      <DegradedBanner />
      {error ? <ErrorCard title="That did not work">{error}</ErrorCard> : null}
      {runResult ? <RunOutcome result={runResult} onDismiss={() => setRunResult(null)} /> : null}

      <Card title="Status">
        <Stack gap="sm">
          <Meta task={task} />
          <RunSummary run={task.run} />
          {task.agent ? <span style={{ fontSize: 12, color: 'var(--vv-text-muted)' }}>{`agent ${task.agent}`}</span> : null}
          {task.touches.length > 0 ? (
            <span style={{ fontSize: 12, color: 'var(--vv-text-muted)' }}>{`touches ${task.touches.join(', ')}`}</span>
          ) : null}
        </Stack>
      </Card>

      <Card title="Task">
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {task.task || <span style={{ color: 'var(--vv-text-muted)' }}>Nothing written yet.</span>}
        </div>
      </Card>

      <Card title="Outcome">
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {task.outcome || <span style={{ color: 'var(--vv-text-muted)' }}>Not run yet.</span>}
        </div>
      </Card>
    </Stack>
  )
}

// ── the entry point ───────────────────────────────────────────────────────────

export default function Wayfinder() {
  const visvine = useVisvine()
  const subject = visvine.subject
  const [selected, setSelected] = useState<string | null>(null)

  if (subject && subject.kind === 'note') {
    const type = typeOf(subject)
    if (type === TASK_TYPE) return <TaskView path={subject.path} />
    if (type === PROJECT_TYPE) {
      const project = projectOfPath(subject.path)
      if (project) return <ProjectView project={project} />
      return (
        <ErrorCard title="That note is not inside a project folder">
          {`${subject.path} is typed ${PROJECT_TYPE}, but Wayfinder projects live at harness/<project>/project.md.`}
        </ErrorCard>
      )
    }
  }

  if (selected) return <ProjectView project={selected} onBack={() => setSelected(null)} />
  return <ProjectList onOpen={setSelected} />
}
