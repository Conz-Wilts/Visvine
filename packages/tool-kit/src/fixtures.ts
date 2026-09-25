/**
 * A Tool's `fixtures/` folder, read into the small space the offline runtime
 * answers from (./mock.ts):
 *
 *   fixtures/space.json    who is looking (`viewer`, or several as `viewers` —
 *                          the first looks first), the install's bindings and
 *                          settings, and what connectors, actions and the AI
 *                          answer
 *   fixtures/notes/        the space's notes — `notes/deals/acme.md` is the
 *                          note `deals/acme.md`
 *   fixtures/resources/    its files — `resources/contracts/msa.pdf` is a file
 *                          under `resources/contracts/`
 *
 * Everything is optional: an empty folder is an empty space.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface FixtureNote {
  path: string
  content: string
  frontmatter: Record<string, unknown>
  body: string
  updatedAt: string
}

export interface FixtureResource {
  /** Its path under `fixtures/resources/`, which is also its id. */
  id: string
  name: string
  kind: string
  mimeType: string
  bytes: Buffer
  /** Where a permission names it: `resources/<folder>/<name>/index.md`. */
  notePath: string
  /** Its text, for a file whose text reads as-is. */
  text: string | null
  createdAt: string
}

export interface FixtureViewer {
  id: string
  name: string
  isAdmin: boolean
}

export interface FixtureSpace {
  viewer: FixtureViewer
  /** Everyone the space may be looked at as — `viewer` first. */
  viewers: FixtureViewer[]
  bindings: Record<string, string>
  settings: Record<string, unknown>
  subject: unknown
  /** `connectors.<name>.<action>` → the answer; `connectors.<name>.code` answers code. */
  connectors: Record<string, Record<string, unknown>>
  actions: Record<string, unknown>
  ai: { complete?: string; decide?: unknown[] }
  notes: Map<string, FixtureNote>
  resources: Map<string, FixtureResource>
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.tsv', '.html', '.xml', '.yaml', '.yml'])
const KINDS: Record<string, [kind: string, mime: string]> = {
  '.png': ['image', 'image/png'],
  '.jpg': ['image', 'image/jpeg'],
  '.jpeg': ['image', 'image/jpeg'],
  '.gif': ['image', 'image/gif'],
  '.webp': ['image', 'image/webp'],
  '.svg': ['image', 'image/svg+xml'],
  '.pdf': ['pdf', 'application/pdf'],
  '.txt': ['text', 'text/plain'],
  '.md': ['text', 'text/markdown'],
  '.csv': ['sheet', 'text/csv'],
  '.tsv': ['sheet', 'text/tab-separated-values'],
  '.json': ['code', 'application/json'],
  '.html': ['code', 'text/html'],
  '.docx': ['doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xlsx': ['sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.pptx': ['slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.mp4': ['video', 'video/mp4'],
  '.mp3': ['audio', 'audio/mpeg'],
  '.zip': ['archive', 'application/zip'],
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out.sort()
}

function posixPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

/** A note's frontmatter and body — the same split the server makes. */
export function splitNote(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (!match) return { frontmatter: {}, body: content }
  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(match[1]) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) frontmatter = parsed as Record<string, unknown>
  } catch {
    frontmatter = {}
  }
  return { frontmatter, body: content.slice(match[0].length) }
}

export function noteOf(path: string, content: string, updatedAt: string = new Date().toISOString()): FixtureNote {
  const { frontmatter, body } = splitNote(content)
  return { path, content, frontmatter, body, updatedAt }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Read a fixtures folder. A missing one is an empty space with an admin looking at it. */
export function loadFixtures(root: string): FixtureSpace {
  let config: Record<string, unknown> = {}
  const spaceFile = join(root, 'space.json')
  if (existsSync(spaceFile)) {
    try {
      config = recordOf(JSON.parse(readFileSync(spaceFile, 'utf8')))
    } catch (err) {
      throw new Error(`fixtures/space.json is not JSON: ${(err as Error).message}`)
    }
  }
  const viewerOf = (raw: unknown, at: number): FixtureViewer => {
    const v = recordOf(raw)
    return {
      id: typeof v.id === 'string' && v.id ? v.id : at === 0 ? 'viewer' : `viewer-${at + 1}`,
      name: typeof v.name === 'string' && v.name ? v.name : at === 0 ? 'You' : `Person ${at + 1}`,
      isAdmin: at === 0 ? v.isAdmin !== false : v.isAdmin === true,
    }
  }
  const viewers = (Array.isArray(config.viewers) && config.viewers.length ? config.viewers : [config.viewer]).map(viewerOf)
  const notes = new Map<string, FixtureNote>()
  const notesRoot = join(root, 'notes')
  for (const file of walk(notesRoot)) {
    if (extname(file) !== '.md') continue
    const path = posixPath(notesRoot, file)
    notes.set(path, noteOf(path, readFileSync(file, 'utf8'), statSync(file).mtime.toISOString()))
  }
  const resources = new Map<string, FixtureResource>()
  const resourcesRoot = join(root, 'resources')
  for (const file of walk(resourcesRoot)) {
    const id = posixPath(resourcesRoot, file)
    const ext = extname(file).toLowerCase()
    const [kind, mimeType] = KINDS[ext] ?? ['file', 'application/octet-stream']
    const bytes = readFileSync(file)
    const stem = id.slice(0, id.length - ext.length).toLowerCase().replace(/[^a-z0-9/]+/g, '-')
    resources.set(id, {
      id,
      name: id.split('/').pop() ?? id,
      kind,
      mimeType,
      bytes,
      notePath: `resources/${stem}/index.md`,
      text: TEXT_EXTENSIONS.has(ext) ? bytes.toString('utf8') : null,
      createdAt: statSync(file).mtime.toISOString(),
    })
  }
  const ai = recordOf(config.ai)
  return {
    viewer: viewers[0],
    viewers,
    bindings: Object.fromEntries(Object.entries(recordOf(config.bindings)).filter((e): e is [string, string] => typeof e[1] === 'string')),
    settings: recordOf(config.settings),
    subject: config.subject ?? null,
    connectors: Object.fromEntries(Object.entries(recordOf(config.connectors)).map(([name, answers]) => [name, recordOf(answers)])),
    actions: recordOf(config.actions),
    ai: { complete: typeof ai.complete === 'string' ? ai.complete : undefined, decide: Array.isArray(ai.decide) ? ai.decide : undefined },
    notes,
    resources,
  }
}
