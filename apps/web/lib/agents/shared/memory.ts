/**
 * An agent's memory note, `agents/<name>/memory.md` — the shape, and the two
 * writes that keep it one.
 *
 * Memory is what an agent CONCLUDED and wants on its next run, not what it
 * did (that is the run's trace, a row). It stays a note because it is read by
 * the next run and by the person checking what the agent believes, it gets a
 * revision history with the agent as author, the clean pass, and grants — so
 * a second agent can be given it. What keeps it from turning into a second
 * transcript is a fixed shape and a gated write: four sections, and
 * `remember` appends one line under one of them rather than the model
 * rewriting the file. "Last run" is the runner's, written mechanically when a
 * run ends, so the next run knows what the last one did without anyone
 * remembering to say so.
 *
 * Pure: strings in, strings out. tests/agents-memory.test.ts.
 */

const MEMORY_SECTIONS = ['What I know', 'Decisions', 'Open threads', 'Last run'] as const
export type MemorySection = (typeof MEMORY_SECTIONS)[number]

/** The sections a `remember` call may write; "Last run" is the runner's. */
export const REMEMBER_SECTIONS: readonly MemorySection[] = ['What I know', 'Decisions', 'Open threads']

/** `<folder>/memory.md` — the agent's folder is `agents/<name>` unless the space filed it elsewhere. */
export const memoryPath = (folder: string) => `${folder}/memory.md`

/** How much of the note a run is handed. */
const MEMORY_PROMPT_CAP_CHARS = 12_000
const MEMORY_LINE_CAP = 400
/** A section's ceiling — the oldest lines fall off, so memory stays a page. */
const MEMORY_LINES_PER_SECTION = 60

export function emptyMemory(name: string): string {
  return `---\ntitle: Memory\nagent: ${name}\n---\n\n` + MEMORY_SECTIONS.map((s) => `## ${s}\n`).join('\n')
}

/** Resolve a section by name, forgiving case and an "and" or two. */
export function memorySectionOf(raw: string): MemorySection | null {
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, '')
  for (const s of MEMORY_SECTIONS) if (s.toLowerCase().replace(/[^a-z]/g, '') === key) return s
  if (key === 'know' || key === 'facts' || key === 'fact' || key === 'knowledge') return 'What I know'
  if (key === 'decision' || key === 'decided') return 'Decisions'
  if (key === 'open' || key === 'threads' || key === 'todo' || key === 'openthread') return 'Open threads'
  return null
}

interface Parsed {
  head: string
  sections: { title: string; lines: string[] }[]
}

function parse(content: string): Parsed {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const sections: Parsed['sections'] = []
  const head: string[] = []
  let cur: { title: string; lines: string[] } | null = null
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      cur = { title: m[1], lines: [] }
      sections.push(cur)
    } else if (cur) cur.lines.push(line)
    else head.push(line)
  }
  return { head: head.join('\n').replace(/\s+$/, ''), sections }
}

function render(p: Parsed): string {
  const body = p.sections.map((s) => `## ${s.title}\n${s.lines.join('\n').replace(/\s+$/, '')}\n`).join('\n')
  return `${p.head}\n\n${body}`.replace(/\n{3,}/g, '\n\n')
}

function ensure(p: Parsed, title: MemorySection): { title: string; lines: string[] } {
  const found = p.sections.find((s) => s.title.toLowerCase() === title.toLowerCase())
  if (found) return found
  const made = { title, lines: [] as string[] }
  // Keep the canonical order: insert before the first section that sorts after it.
  const rank = (t: string) => {
    const i = MEMORY_SECTIONS.findIndex((s) => s.toLowerCase() === t.toLowerCase())
    return i === -1 ? MEMORY_SECTIONS.length : i
  }
  const at = p.sections.findIndex((s) => rank(s.title) > rank(title))
  if (at === -1) p.sections.push(made)
  else p.sections.splice(at, 0, made)
  return made
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MEMORY_LINE_CAP)

/**
 * Append one claim under a section. A line already there (exact, case-
 * insensitive) is not added twice; a section past its ceiling drops its
 * oldest line. Returns the new note and whether anything changed.
 */
export function rememberInto(content: string | null, name: string, section: MemorySection, claim: string, date?: string): { content: string; changed: boolean } {
  const p = parse(content?.trim() ? content : emptyMemory(name))
  const s = ensure(p, section)
  const text = oneLine(claim)
  if (!text) return { content: render(p), changed: false }
  const line = date ? `- ${date} — ${text}` : `- ${text}`
  const dup = s.lines.some((l) => l.replace(/^- (\d{4}-\d{2}-\d{2} — )?/, '').trim().toLowerCase() === text.toLowerCase())
  if (dup) return { content: render(p), changed: false }
  const kept = s.lines.filter((l) => l.trim())
  kept.push(line)
  while (kept.length > MEMORY_LINES_PER_SECTION) kept.shift()
  s.lines = kept
  return { content: render(p), changed: true }
}

/** Replace the "Last run" section with what the run just did. The runner's write. */
export function setLastRun(content: string | null, name: string, input: { date: string; trigger: string; summary: string | null; forName?: string | null }): string {
  const p = parse(content?.trim() ? content : emptyMemory(name))
  const s = ensure(p, 'Last run')
  const who = input.forName ? ` for ${input.forName}` : ''
  const summary = input.summary ? oneLine(input.summary).slice(0, MEMORY_LINE_CAP) : 'No summary.'
  s.lines = [`${input.date} · ${input.trigger}${who}`, '', summary]
  return render(p)
}

/** What a run is handed: the body without frontmatter, clipped. */
export function memoryForPrompt(content: string | null): string | null {
  if (!content?.trim()) return null
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
  if (!body || /^(## [^\n]+\n*)+$/.test(body)) return null
  return body.length > MEMORY_PROMPT_CAP_CHARS ? body.slice(0, MEMORY_PROMPT_CAP_CHARS) + '\n…[memory truncated]' : body
}

/** What the agent carries between runs, a section at a time — dates and bullets stripped, empty sections left out. */
export function memorySections(content: string | null): { section: MemorySection; lines: string[] }[] {
  const p = parse(content ?? '')
  return REMEMBER_SECTIONS.map((section) => ({
    section,
    lines: (p.sections.find((s) => s.title.toLowerCase() === section.toLowerCase())?.lines ?? [])
      .map((l) => l.replace(/^-\s*/, '').replace(/^\d{4}-\d{2}-\d{2} — /, '').trim())
      .filter(Boolean),
  })).filter((s) => s.lines.length > 0)
}
