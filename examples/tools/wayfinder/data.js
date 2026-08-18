// The server-side half of the Wayfinder Tool. This runs in the QuickJS isolate
// (lib/tools/dataRun.ts) as a plain script — no imports, no exports, no network.
// `visvine` is the same bridge the interface uses, so every read and write below
// goes through the perimeter declared in index.md and lands under the viewer's
// own grants.
//
// All note marshalling lives here rather than in ui.tsx so there is exactly one
// place that knows the note layout.
//
// Frontmatter: nothing is parsed in the Tool. `visvine.context.read` hands back
// `frontmatter` already parsed by Visvine's own YAML parser, and everything
// written back is serialized as JSON — a strict subset of YAML 1.2 — so the two
// sides cannot drift and no parser ships in the isolate. See index.md.

const HARNESS = 'harness'
const PROJECT_TYPE = 'wayfinder-project'
const TASK_TYPE = 'wayfinder-task'

/** Same shape as a Tool name: a URL-ish slug, so it can sit in a note path. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
/** A task id is short and file-safe; the harness uses `001`, but `a1` is fine. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/

const STATUSES = ['todo', 'doing', 'done', 'failed']
const SIZES = ['xs', 's', 'm', 'l', 'xl']

/** Most task notes one `loadProject` will read. The isolate has 20s and each
 *  read is a round trip; a larger board comes back truncated and says so. */
const MAX_TASKS = 60

// ── paths ────────────────────────────────────────────────────────────────────

function projectDir(project) {
  return HARNESS + '/' + project
}
function projectPath(project) {
  return projectDir(project) + '/project.md'
}
function tasksDir(project) {
  return projectDir(project) + '/tasks'
}
function agentName(project, id) {
  return 'wayfinder-' + project + '-' + String(id).toLowerCase()
}
function briefPath(project, id) {
  return 'agents/' + agentName(project, id) + '.md'
}

/** The project a `harness/<project>/…` path belongs to, or null. */
function projectOfPath(path) {
  const m = /^harness\/([^/]+)\//.exec(String(path || ''))
  return m && NAME_RE.test(m[1]) ? m[1] : null
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function requireName(project) {
  const name = String(project || '').trim().toLowerCase()
  if (!NAME_RE.test(name)) {
    throw new Error('"' + project + '" is not a project name — use lower-case letters, digits and hyphens.')
  }
  return name
}

function requireId(id) {
  const value = String(id == null ? '' : id).trim()
  if (!ID_RE.test(value)) throw new Error('"' + id + '" is not a task id.')
  return value
}

// ── notes ────────────────────────────────────────────────────────────────────

/** Everything after the frontmatter block. The only parsing this Tool does. */
function bodyOf(content) {
  const text = String(content == null ? '' : content)
  if (!/^---\r?\n/.test(text)) return text.trim()
  const close = text.indexOf('\n---', 3)
  if (close === -1) return text.trim()
  const eol = text.indexOf('\n', close + 1)
  return eol === -1 ? '' : text.slice(eol + 1).trim()
}

/**
 * A frontmatter block whose every value is JSON. Valid YAML, and the exact text
 * Visvine's parser reads back — see the note at the top of this file. Keys with
 * a null/undefined value are dropped rather than written as `null`, so clearing
 * a field removes the line.
 */
function renderFrontmatter(meta) {
  const lines = []
  for (const key of Object.keys(meta)) {
    const value = meta[key]
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) {
      lines.push(key + ': []')
      continue
    }
    lines.push(key + ': ' + JSON.stringify(value))
  }
  return lines.join('\n')
}

function noteText(meta, body) {
  return '---\n' + renderFrontmatter(meta) + '\n---\n\n' + String(body || '').trim() + '\n'
}

/** The body split at its `## ` headings, leading text first with a null heading. */
function splitSections(body) {
  const parts = [{ heading: null, lines: [] }]
  for (const line of String(body || '').split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) parts.push({ heading: m[1], lines: [] })
    else parts[parts.length - 1].lines.push(line)
  }
  return parts
}

function sectionOf(body, heading) {
  const wanted = String(heading).toLowerCase()
  for (const part of splitSections(body)) {
    if (part.heading && part.heading.toLowerCase() === wanted) return part.lines.join('\n').trim()
  }
  return ''
}

/** Replace one `## <heading>` section, appending it when the body has none. */
function withSection(body, heading, text) {
  const wanted = String(heading).toLowerCase()
  const blocks = []
  let found = false
  for (const part of splitSections(body)) {
    if (!part.heading) {
      const lead = part.lines.join('\n').trim()
      if (lead) blocks.push(lead)
      continue
    }
    if (part.heading.toLowerCase() === wanted) {
      found = true
      blocks.push('## ' + part.heading + '\n\n' + String(text || '').trim())
    } else {
      blocks.push('## ' + part.heading + '\n' + part.lines.join('\n').replace(/\s+$/, ''))
    }
  }
  if (!found) blocks.push('## ' + heading + '\n\n' + String(text || '').trim())
  return blocks.join('\n\n').trim() + '\n'
}

/** A note, or null when there isn't one. The bridge answers absent and invisible
 *  the same way on purpose, so this cannot be used to map a folder either. */
async function readOrNull(visvine, path) {
  try {
    return await visvine.context.read(path)
  } catch (e) {
    const message = e && e.message ? String(e.message) : ''
    if (/^No note at /.test(message)) return null
    throw e
  }
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function stringList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((entry) => trimmed(entry)).filter((entry) => entry !== '')
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
  }
  return []
}

function waveNumber(raw, fallback) {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

function oneOf(raw, allowed, fallback) {
  const value = trimmed(raw).toLowerCase()
  return allowed.indexOf(value) === -1 ? fallback : value
}

function wavesOf(raw) {
  if (!Array.isArray(raw)) return []
  const waves = []
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      waves.push({ n: waveNumber(entry.n, waves.length + 1), title: trimmed(entry.title) })
    } else {
      waves.push({ n: waveNumber(entry, waves.length + 1), title: '' })
    }
  }
  return waves.sort((a, b) => a.n - b.n)
}

function runOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return {
    id: trimmed(raw.id),
    status: trimmed(raw.status),
    at: trimmed(raw.at),
    detail: trimmed(raw.detail),
  }
}

// ── documents ────────────────────────────────────────────────────────────────

function projectDoc(project, note) {
  const fm = note.frontmatter || {}
  const body = bodyOf(note.content)
  return {
    name: project,
    path: note.path,
    title: trimmed(fm.title) || project,
    goal: trimmed(fm.goal) || sectionOf(body, 'Goal'),
    status: trimmed(fm.status) || 'active',
    waves: wavesOf(fm.waves),
    brief: sectionOf(body, 'Brief'),
    plan: sectionOf(body, 'Plan'),
  }
}

function taskDoc(note) {
  const fm = note.frontmatter || {}
  const body = bodyOf(note.content)
  return {
    path: note.path,
    id: trimmed(fm.id) || String(fm.id == null ? '' : fm.id),
    title: trimmed(fm.title) || note.path.split('/').pop(),
    status: oneOf(fm.status, STATUSES, 'todo'),
    size: oneOf(fm.size, SIZES, ''),
    wave: waveNumber(fm.wave, 1),
    depends_on: stringList(fm.depends_on),
    touches: stringList(fm.touches),
    agent: trimmed(fm.agent),
    run: runOf(fm.run),
    task: sectionOf(body, 'Task'),
    outcome: sectionOf(body, 'Outcome'),
  }
}

/** A task document → the note it is stored as, preserving unknown sections. */
function taskNote(doc, previousBody) {
  const meta = {
    type: TASK_TYPE,
    id: doc.id,
    title: doc.title,
    status: doc.status,
    size: doc.size || undefined,
    wave: doc.wave,
    depends_on: doc.depends_on,
    touches: doc.touches,
    agent: doc.agent || undefined,
    run: doc.run && doc.run.status ? doc.run : undefined,
  }
  let body = previousBody == null ? '' : previousBody
  body = withSection(body, 'Task', doc.task)
  body = withSection(body, 'Outcome', doc.outcome)
  return noteText(meta, body)
}

function projectNote(doc, previousBody) {
  const meta = {
    type: PROJECT_TYPE,
    title: doc.title,
    goal: doc.goal,
    status: doc.status,
    waves: doc.waves,
  }
  let body = previousBody == null ? '' : previousBody
  body = withSection(body, 'Goal', doc.goal)
  body = withSection(body, 'Brief', doc.brief)
  body = withSection(body, 'Plan', doc.plan)
  return noteText(meta, body)
}

function isType(entry, type) {
  return trimmed(entry && entry.type).toLowerCase() === type
}

// ── handlers ─────────────────────────────────────────────────────────────────

/**
 * Every project in the space, with how many tasks each holds. One list call:
 * the entries carry the frontmatter `type`, which is all this needs.
 */
handlers.listProjects = async (a, visvine) => {
  const entries = await visvine.context.list(HARNESS + '/**')
  const projects = []
  const counts = {}
  for (const entry of entries) {
    const project = projectOfPath(entry.path)
    if (!project) continue
    if (entry.path === projectPath(project) && isType(entry, PROJECT_TYPE)) {
      projects.push({ name: project, path: entry.path, title: entry.title || project, updatedAt: entry.updatedAt })
    } else if (isType(entry, TASK_TYPE)) {
      counts[project] = (counts[project] || 0) + 1
    }
  }
  for (const project of projects) project.tasks = counts[project.name] || 0
  projects.sort((a1, b1) => a1.name.localeCompare(b1.name))
  return { projects }
}

/** Create `harness/<name>/project.md`. Refuses to overwrite one that exists. */
handlers.createProject = async (a, visvine) => {
  const name = requireName(a && a.name ? a.name : slugify(a && a.title))
  const path = projectPath(name)
  if (await readOrNull(visvine, path)) {
    throw new Error('A project already exists at ' + path + '.')
  }
  const waves = wavesOf(a && a.waves)
  const doc = {
    name,
    path,
    title: trimmed(a && a.title) || name,
    goal: trimmed(a && a.goal),
    status: 'active',
    waves: waves.length > 0 ? waves : [{ n: 1, title: 'Wave 1' }],
    brief: trimmed(a && a.brief),
    plan: trimmed(a && a.plan),
  }
  await visvine.context.write(path, projectNote(doc, ''))
  return { project: doc }
}

/** One project and its board. */
handlers.loadProject = async (a, visvine) => {
  const project = requireName(a && a.project)
  const note = await readOrNull(visvine, projectPath(project))
  if (!note) throw new Error('No project at ' + projectPath(project) + '.')

  const entries = await visvine.context.list(tasksDir(project) + '/**')
  const wanted = entries.filter((entry) => isType(entry, TASK_TYPE))
  const truncated = wanted.length > MAX_TASKS
  const tasks = []
  for (const entry of wanted.slice(0, MAX_TASKS)) {
    const taskNoteRow = await readOrNull(visvine, entry.path)
    if (taskNoteRow) tasks.push(taskDoc(taskNoteRow))
  }
  tasks.sort((x, y) => (x.wave - y.wave) || x.id.localeCompare(y.id))
  return { project: projectDoc(project, note), tasks, truncated }
}

/** The plan panel's save: goal, brief, status and the wave list. */
handlers.saveProject = async (a, visvine) => {
  const project = requireName(a && a.project)
  const path = projectPath(project)
  const note = await readOrNull(visvine, path)
  if (!note) throw new Error('No project at ' + path + '.')

  const current = projectDoc(project, note)
  const patch = (a && a.patch) || {}
  const doc = {
    name: project,
    path,
    title: patch.title === undefined ? current.title : trimmed(patch.title) || project,
    goal: patch.goal === undefined ? current.goal : trimmed(patch.goal),
    status: patch.status === undefined ? current.status : trimmed(patch.status) || 'active',
    waves: patch.waves === undefined ? current.waves : wavesOf(patch.waves),
    brief: patch.brief === undefined ? current.brief : trimmed(patch.brief),
    plan: patch.plan === undefined ? current.plan : trimmed(patch.plan),
  }
  await visvine.context.write(path, projectNote(doc, bodyOf(note.content)))
  return { project: doc }
}

/** One task read on its own — what the `wayfinder-task` type page renders. */
handlers.loadTask = async (a, visvine) => {
  const path = String((a && a.path) || '')
  const project = projectOfPath(path)
  if (!project) throw new Error('"' + path + '" is not a task in a Wayfinder project.')
  const note = await readOrNull(visvine, path)
  if (!note) throw new Error('No note at ' + path + '.')
  const projectNoteRow = await readOrNull(visvine, projectPath(project))
  return {
    task: taskDoc(note),
    project: projectNoteRow ? projectDoc(project, projectNoteRow) : null,
  }
}

/**
 * Create or update one task. `path` names an existing note; without one a new
 * task is filed at `tasks/<id>-<slug>.md`.
 */
handlers.saveTask = async (a, visvine) => {
  const project = requireName(a && a.project)
  const patch = (a && a.patch) || {}
  const existingPath = trimmed(a && a.path)

  let previous = null
  if (existingPath) {
    if (projectOfPath(existingPath) !== project) {
      throw new Error(existingPath + ' is not a task in ' + project + '.')
    }
    previous = await readOrNull(visvine, existingPath)
    if (!previous) throw new Error('No note at ' + existingPath + '.')
  }

  const current = previous
    ? taskDoc(previous)
    : {
        id: requireId(patch.id),
        title: '',
        status: 'todo',
        size: '',
        wave: 1,
        depends_on: [],
        touches: [],
        agent: '',
        run: null,
        task: '',
        outcome: '',
      }

  const doc = {
    id: current.id,
    title: patch.title === undefined ? current.title : trimmed(patch.title) || current.id,
    status: patch.status === undefined ? current.status : oneOf(patch.status, STATUSES, current.status),
    size: patch.size === undefined ? current.size : oneOf(patch.size, SIZES, ''),
    wave: patch.wave === undefined ? current.wave : waveNumber(patch.wave, current.wave),
    depends_on: patch.depends_on === undefined ? current.depends_on : stringList(patch.depends_on),
    touches: patch.touches === undefined ? current.touches : stringList(patch.touches),
    agent: current.agent,
    run: current.run,
    task: patch.task === undefined ? current.task : String(patch.task || '').trim(),
    outcome: patch.outcome === undefined ? current.outcome : String(patch.outcome || '').trim(),
  }

  const path =
    existingPath || tasksDir(project) + '/' + doc.id + '-' + (slugify(doc.title) || 'task') + '.md'
  if (!existingPath && (await readOrNull(visvine, path))) {
    throw new Error('A task already exists at ' + path + '.')
  }
  await visvine.context.write(path, taskNote(doc, previous ? bodyOf(previous.content) : ''))
  doc.path = path
  return { task: doc }
}

/** Move a card between columns: one frontmatter field, rewritten in place. */
handlers.moveTask = async (a, visvine) => {
  const path = trimmed(a && a.path)
  const project = projectOfPath(path)
  if (!project) throw new Error('"' + path + '" is not a task in a Wayfinder project.')
  const note = await readOrNull(visvine, path)
  if (!note) throw new Error('No note at ' + path + '.')

  const doc = taskDoc(note)
  doc.wave = waveNumber(a && a.wave, doc.wave)
  await visvine.context.write(path, taskNote(doc, bodyOf(note.content)))
  doc.path = path
  return { task: doc }
}

/** The brief text an agent would be given for one task. */
function briefFor(project, projectTitle, task) {
  const meta = {
    type: 'agent',
    title: 'Wayfinder ' + task.id + ': ' + task.title,
    description: 'Works task ' + task.id + ' of ' + projectTitle + ' and records the outcome.',
    model: 'gemini/gemma-4-31b-it',
    connectors: [],
    tools: [],
  }
  const body = [
    'You are working one task from the ' + projectTitle + ' plan, tracked at `' + projectPath(project) + '`.',
    '',
    '## Task',
    '',
    task.task || '(The task note has no `## Task` section yet.)',
    '',
    '## When you are done',
    '',
    'Append what you did, and how you checked it, to `' + task.path + '` under the',
    '`## Outcome` heading. Do not change the frontmatter and do not touch any other',
    'note. If you could not finish, say what stopped you under the same heading.',
  ].join('\n')
  return noteText(meta, body)
}

/**
 * Dispatch a task.
 *
 * Three steps, each of which can honestly fail:
 *
 *  1. The brief at `agents/wayfinder-<project>-<id>.md` must exist. A Tool may
 *     not write one — `agents/` is sealed against Tool writes whatever the
 *     perimeter declares, because a brief runs unattended on the space's model
 *     key. The write is still attempted, so the refusal is the real one and not
 *     this Tool's guess at it, and the brief text comes back for a person to save.
 *  2. `visvine.agents.run(name)` needs the agent to be ACTIVE, which is a space
 *     admin's act (`agents/live/<name>.md`).
 *  3. Whatever happened is recorded on the task's own frontmatter, so the board
 *     still says so after a reload.
 */
handlers.runTask = async (a, visvine) => {
  const path = trimmed(a && a.path)
  const project = projectOfPath(path)
  if (!project) throw new Error('"' + path + '" is not a task in a Wayfinder project.')
  const note = await readOrNull(visvine, path)
  if (!note) throw new Error('No note at ' + path + '.')

  const projectNoteRow = await readOrNull(visvine, projectPath(project))
  const projectTitle = projectNoteRow ? projectDoc(project, projectNoteRow).title : project
  const doc = taskDoc(note)
  doc.path = path
  const name = agentName(project, doc.id)
  const brief = { path: briefPath(project, doc.id), name, status: 'present', reason: '', text: '' }

  const existing = await readOrNull(visvine, brief.path)
  if (!existing) {
    brief.text = briefFor(project, projectTitle, doc)
    try {
      await visvine.context.write(brief.path, brief.text)
      brief.status = 'written'
    } catch (e) {
      brief.status = 'refused'
      brief.reason = e && e.message ? String(e.message) : 'the write was refused'
    }
  }

  const at = new Date().toISOString()
  let run = null
  if (brief.status === 'refused') {
    run = { id: '', status: 'blocked', at: at, detail: 'no agent brief at ' + brief.path }
  } else {
    try {
      const started = await visvine.agents.run(name)
      run = { id: trimmed(started && started.runId), status: 'queued', at: at, detail: '' }
    } catch (e) {
      run = {
        id: '',
        status: 'refused',
        at: at,
        detail: e && e.message ? String(e.message) : 'the run was refused',
      }
    }
  }

  doc.agent = name
  doc.run = run
  if (run.status === 'queued' && doc.status === 'todo') doc.status = 'doing'
  await visvine.context.write(path, taskNote(doc, bodyOf(note.content)))

  return { task: doc, brief: brief, run: run }
}
