/**
 * The offline runtime: a Tool's bridge answered from its `fixtures/` folder
 * (./fixtures.ts) instead of a Visvine space — what `visvine-tool dev` runs a
 * Tool against before it ever reaches a server.
 *
 * It keeps the server's first rule: the Tool's own declaration answers
 * before anything is read. Every method asks the same gates the server asks
 * (@visvine/tool-protocol — the perimeter, the reach families, the collection
 * rules), over the reach the manifest declares with each binding slot filled
 * from `space.json` or its own suggestion, so a call the Tool never declared
 * is refused here with the sentence Visvine would say. What it cannot be is
 * the server's view of a person: there are no grants offline, and the viewer
 * is whoever `space.json` says.
 *
 * Writes land in memory — the notes, state and collection rows — and are
 * announced through `onChange`, as the server's change stream would.
 */
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import {
  BRIDGE_LIMITS,
  isBridgeMethod,
  type BridgeMethod,
  type BridgeResponse,
  type CollectionRow,
  type ContextEntry,
  type ContextHit,
  type ToolDegraded,
  type ToolInstallInfo,
  type ToolRecord,
  type ToolResource,
} from '@visvine/tool-protocol/protocol'
import { globMatch, isValidGlobEntry, refuseAgent, refuseConnector, refuseRead, refuseWrite } from '@visvine/tool-protocol/perimeter'
import {
  refuseAction,
  refuseAi,
  refuseConnectorCall,
  refuseRecordRead,
  refuseRecordWrite,
  refuseResourceList,
  refuseResourceRead,
} from '@visvine/tool-protocol/reach'
import { planSettings, resolveReach, sourceBindings, type ToolReach } from '@visvine/tool-protocol/bindings'
import type { ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import { rowDenial } from '@visvine/tool-protocol/schema'
import {
  collectionChangePath,
  collectionDenial,
  LIST_LIMIT_MAX,
  queryDenial,
  readsOwnOnly,
  rowMatches,
  rowSizeDenial,
} from '@visvine/tool-protocol/collections'
import { ISOLATE_METHODS, ISOLATE_PARAMS } from '@visvine/tool-protocol/isolate'
import { noteOf, type FixtureNote, type FixtureSpace, type FixtureViewer } from './fixtures'

export interface MockTool {
  name: string
  title: string
  facts: ToolManifestFacts
  /** The compiled data.js, or '' when the Tool has none. */
  dataBundle: string
}

export interface MockOptions {
  tool: MockTool
  space: FixtureSpace
  /** Paths a write changed, as the change stream would announce them. */
  onChange?: (paths: string[]) => void
}

export interface MockCallLog {
  method: string
  ok: boolean
  code?: string
  message?: string
}

export interface MockBridge {
  call(method: string, params: unknown): Promise<BridgeResponse>
  /** What the frame is told at its handshake. */
  init(): { install: ToolInstallInfo; viewer: FixtureViewer; degraded: ToolDegraded | null; subject: unknown }
  /** Look at the Tool as someone else — an admin, a member. */
  setViewer(viewer: Partial<FixtureViewer>): void
  /** Swap in a rebuilt Tool (a changed manifest or data.js) without losing what was written. */
  setTool(tool: MockTool): void
}

interface StoredRow {
  id: string
  data: Record<string, unknown>
  userId: string
  createdAt: string
  updatedAt: string
}

const ok = (value: unknown): BridgeResponse => ({ ok: true, value })
const err = (code: Extract<BridgeResponse, { ok: false }>['error']['code'], message: string): BridgeResponse => ({ ok: false, error: { code, message } })
const RESERVED_FIELDS = new Set(['type', 'title', 'tags', 'description', 'node'])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function cursorOf(value: string | number): string {
  return Buffer.from(String(value), 'utf8').toString('base64url')
}

function uncursor(cursor: unknown): string | null {
  if (typeof cursor !== 'string' || !cursor) return null
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function withFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}` : body
}

export function createMockBridge(opts: MockOptions): MockBridge {
  let tool = opts.tool
  const space = opts.space
  let viewer: FixtureViewer = { ...space.viewer }
  const state = new Map<string, unknown>()
  const rows = new Map<string, StoredRow[]>()
  const announce = (paths: string[]) => {
    if (paths.length) opts.onChange?.(paths)
  }

  const bindings = () => ({ ...sourceBindings(tool.facts), ...space.bindings })
  const resolved = () => resolveReach(tool.facts, bindings())
  const reach = (): ToolReach => resolved().reach
  const settings = () => {
    const planned = planSettings(tool.facts, space.settings)
    return planned.ok ? planned.value : planSettings(tool.facts, {}).ok ? (planSettings(tool.facts, {}) as { value: Record<string, unknown> }).value : {}
  }

  const entryOf = (note: FixtureNote): ContextEntry => ({
    path: note.path,
    title: str(note.frontmatter.title),
    type: str(note.frontmatter.type),
    updatedAt: note.updatedAt,
  })

  const recordOf = (note: FixtureNote): ToolRecord => ({
    path: note.path,
    type: String(note.frontmatter.type ?? ''),
    title: str(note.frontmatter.title) ?? note.path.split('/').pop()!.replace(/\.md$/, ''),
    tags: Array.isArray(note.frontmatter.tags) ? note.frontmatter.tags.map(String) : [],
    updatedAt: note.updatedAt,
    fields: Object.fromEntries(Object.entries(note.frontmatter).filter(([key]) => !RESERVED_FIELDS.has(key))),
    invalid: [],
  })

  const resourceOf = (r: FixtureSpace['resources'] extends Map<string, infer R> ? R : never): ToolResource => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    source: 'upload',
    mimeType: r.mimeType,
    fileSize: r.bytes.length,
    url: null,
    notePath: r.notePath,
    hasText: r.text !== null,
    createdAt: r.createdAt,
  })

  const rowOf = (row: StoredRow): CollectionRow => ({
    id: row.id,
    data: row.data,
    mine: row.userId === viewer.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

  // ── the methods ──────────────────────────────────────────────────────────

  async function handle(method: BridgeMethod, raw: unknown): Promise<BridgeResponse> {
    const p = record(raw)
    const r = reach()
    switch (method) {
      case 'context.list': {
        const glob = typeof p.glob === 'string' ? p.glob : undefined
        if (glob !== undefined && !isValidGlobEntry(glob)) return err('invalid', `"${glob}" is not a glob.`)
        const after = uncursor(p.cursor)
        const all = [...space.notes.values()]
          .filter((note) => refuseRead(r, note.path) === null && (glob === undefined || globMatch(glob, note.path)))
          .sort((a, b) => (a.path < b.path ? -1 : 1))
          .filter((note) => after === null || note.path > after)
        const page = all.slice(0, BRIDGE_LIMITS.maxRows).map(entryOf)
        if (p.cursor === undefined && !p.page) return ok(page)
        return ok({ items: page, nextCursor: all.length > page.length ? cursorOf(page[page.length - 1].path) : null })
      }
      case 'context.read': {
        const path = String(p.path ?? '')
        const refused = refuseRead(r, path)
        if (refused) return err('perimeter', refused)
        const note = space.notes.get(path)
        if (!note) return err('not_found', `No note at ${path}.`)
        return ok({ path, content: note.content, frontmatter: note.frontmatter })
      }
      case 'context.search': {
        const query = String(p.query ?? '').toLowerCase().trim()
        if (!query) return err('invalid', 'query: say what to search for')
        const words = query.split(/\s+/)
        const offset = Number(uncursor(p.cursor) ?? 0) || 0
        const k = Math.min(Math.max(Number(p.k) || 10, 1), BRIDGE_LIMITS.maxRows)
        const hits: ContextHit[] = []
        for (const note of space.notes.values()) {
          if (refuseRead(r, note.path) !== null) continue
          const title = (str(note.frontmatter.title) ?? '').toLowerCase()
          const body = note.body.toLowerCase()
          const score = words.reduce((sum, word) => sum + (title.includes(word) ? 3 : 0) + (body.includes(word) ? 1 : 0), 0)
          if (score === 0) continue
          const at = Math.max(0, body.indexOf(words[0]) - 60)
          hits.push({ path: note.path, title: str(note.frontmatter.title), snippet: note.body.slice(at, at + 180).trim(), score: score / (words.length * 4) })
        }
        hits.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
        const page = hits.slice(offset, offset + k)
        if (p.cursor === undefined && !p.page) return ok(page)
        return ok({ items: page, nextCursor: offset + k < hits.length ? cursorOf(offset + k) : null })
      }
      case 'context.write':
      case 'context.append': {
        const path = String(p.path ?? '')
        const refused = refuseWrite(r, path)
        if (refused) return err('perimeter', refused)
        if (!path.endsWith('.md')) return err('invalid', 'A note is a .md path.')
        const previous = space.notes.get(path)
        const content = method === 'context.write' ? String(p.content ?? '') : `${previous?.content ?? ''}${previous ? '\n' : ''}${String(p.text ?? '')}`
        if (Buffer.byteLength(content, 'utf8') > BRIDGE_LIMITS.maxWriteBytes) return err('too_large', `A write is at most ${BRIDGE_LIMITS.maxWriteBytes} bytes.`)
        space.notes.set(path, noteOf(path, content))
        announce([path])
        return ok({ path })
      }
      case 'context.links': {
        const path = String(p.path ?? '')
        const refused = refuseRead(r, path)
        if (refused) return err('perimeter', refused)
        const note = space.notes.get(path)
        if (!note) return err('not_found', `No note at ${path}.`)
        const targets = (text: string, from: string) =>
          [...text.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => {
            const dir = from.split('/').slice(0, -1)
            for (const part of m[1].split('/')) {
              if (part === '..') dir.pop()
              else if (part !== '.') dir.push(part)
            }
            return dir.join('/')
          })
        const readable = (target: string) => space.notes.has(target) && refuseRead(r, target) === null
        const outgoing = [...new Set(targets(note.body, path))].filter(readable).map((target) => ({ path: target, title: str(space.notes.get(target)!.frontmatter.title) }))
        const incoming = [...space.notes.values()]
          .filter((other) => other.path !== path && refuseRead(r, other.path) === null && targets(other.body, other.path).includes(path))
          .map((other) => ({ path: other.path, title: str(other.frontmatter.title) }))
        return ok({ outgoing, incoming })
      }
      case 'records.query': {
        const type = String(p.type ?? '')
        const refused = refuseRecordRead(r, type)
        if (refused) return err('perimeter', refused)
        let found = [...space.notes.values()].filter((note) => String(note.frontmatter.type ?? '').toLowerCase() === type.toLowerCase()).map(recordOf)
        for (const w of Array.isArray(p.where) ? (p.where as Array<Record<string, unknown>>) : []) {
          const key = String(w.key)
          const value = (rec: ToolRecord) => (key === 'title' ? rec.title : rec.fields[key])
          if (w.op === 'eq') found = found.filter((rec) => value(rec) === w.value)
          if (w.op === 'in') found = found.filter((rec) => (w.values as unknown[]).includes(value(rec)))
          if (w.op === 'contains') found = found.filter((rec) => String(value(rec) ?? '').toLowerCase().includes(String(w.value).toLowerCase()))
          if (w.op === 'range') {
            found = found.filter((rec) => {
              const v = value(rec) as string | number
              return (w.min === undefined || v >= (w.min as string | number)) && (w.max === undefined || v <= (w.max as string | number))
            })
          }
        }
        const order = record(p.order)
        if (typeof order.key === 'string') {
          const key = order.key
          const sign = order.direction === 'desc' ? -1 : 1
          const value = (rec: ToolRecord) => (key === 'title' ? rec.title : key === 'updated' ? rec.updatedAt : (rec.fields[key] as string | number | undefined))
          found.sort((a, b) => ((value(a) ?? '') < (value(b) ?? '') ? -sign : (value(a) ?? '') > (value(b) ?? '') ? sign : 0))
        }
        const offset = Number(uncursor(p.cursor) ?? 0) || 0
        const limit = Math.min(Math.max(Number(p.limit) || 50, 1), BRIDGE_LIMITS.maxRows)
        const page = found.slice(offset, offset + limit)
        return ok({ type, rows: page, nextCursor: offset + limit < found.length ? cursorOf(offset + limit) : null, total: found.length })
      }
      case 'records.get':
      case 'records.update': {
        const path = String(p.path ?? '')
        const note = space.notes.get(path)
        if (!note) return err('not_found', 'No such record.')
        const type = String(note.frontmatter.type ?? '')
        if (method === 'records.get') {
          const refused = refuseRecordRead(r, type)
          return refused ? err('perimeter', refused) : ok(recordOf(note))
        }
        const fields = record(p.fields)
        const refused = refuseRecordWrite(r, type, Object.keys(fields))
        if (refused) return err('perimeter', refused)
        const frontmatter = { ...note.frontmatter }
        for (const [key, value] of Object.entries(fields)) {
          if (value === '' || value === null) delete frontmatter[key]
          else frontmatter[key] = value
        }
        space.notes.set(path, noteOf(path, withFrontmatter(frontmatter, note.body)))
        announce([path])
        return ok({ record: path, fields })
      }
      case 'resources.list': {
        const refused = refuseResourceList(r)
        if (refused) return err('perimeter', refused)
        const q = typeof p.q === 'string' ? p.q.toLowerCase() : null
        const folder = typeof p.folder === 'string' ? p.folder.replace(/^resources\//, '').replace(/\/$/, '') : null
        const items = [...space.resources.values()]
          .filter((res) => refuseResourceRead(r, res.notePath) === null)
          .filter((res) => (folder === null || res.id.startsWith(`${folder}/`)) && (p.kind === undefined || res.kind === p.kind) && (q === null || res.name.toLowerCase().includes(q)))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map(resourceOf)
        return ok({ items: items.slice(0, BRIDGE_LIMITS.maxRows), nextCursor: null })
      }
      case 'resources.get':
      case 'resources.read':
      case 'resources.blob': {
        const res = space.resources.get(String(p.id ?? ''))
        const refused = res ? refuseResourceRead(r, res.notePath) : null
        if (refused) return err('perimeter', refused)
        if (!res) return err('not_found', 'No such file.')
        if (method === 'resources.get') return ok(resourceOf(res))
        if (method === 'resources.read') {
          if (res.text === null) return err('not_found', `${res.name} has no text to read.`)
          const offset = Math.max(0, Number(p.offset) || 0)
          const text = res.text.slice(offset, offset + BRIDGE_LIMITS.maxResourceReadChars)
          const next = offset + text.length
          return ok({ text, offset, totalChars: res.text.length, nextOffset: next < res.text.length ? next : null })
        }
        if (res.bytes.length > BRIDGE_LIMITS.maxBlobBytes) return err('too_large', `${res.name} is over ${BRIDGE_LIMITS.maxBlobBytes} bytes.`)
        return ok({ mimeType: res.mimeType, dataUrl: `data:${res.mimeType};base64,${res.bytes.toString('base64')}` })
      }
      case 'connectors.call': {
        const name = String(p.name ?? '')
        const refused =
          refuseConnector(r, name) ?? refuseConnectorCall(r, name, { code: typeof p.code === 'string' ? p.code : undefined, action: typeof p.action === 'string' ? p.action : undefined })
        if (refused) return err('perimeter', refused)
        const answers = space.connectors[name] ?? {}
        const key = typeof p.action === 'string' ? p.action : 'code'
        if (!(key in answers)) return err('degraded', `Offline: fixtures/space.json has no answer for connectors.${name}.${key}.`)
        return ok(answers[key])
      }
      case 'agents.run': {
        const refused = refuseAgent(r, String(p.name ?? ''))
        return refused ? err('perimeter', refused) : ok({ runId: `offline-${randomUUID().slice(0, 8)}` })
      }
      case 'actions.run': {
        const name = String(p.name ?? '')
        const refused = refuseAction(r, name)
        if (refused) return err('perimeter', refused)
        return ok(name in space.actions ? space.actions[name] : { ok: true, offline: true })
      }
      case 'ai.complete': {
        const refused = refuseAi(r, 'complete')
        if (refused) return err('perimeter', refused)
        return ok({ text: space.ai.complete ?? `(offline) ${String(p.prompt ?? 'an answer').slice(0, 80)}` })
      }
      case 'ai.decide': {
        const refused = refuseAi(r, 'decide')
        if (refused) return err('perimeter', refused)
        const items = Array.isArray(p.items) ? p.items : []
        return ok(items.map((_, i) => (space.ai.decide?.[i] as unknown) ?? null))
      }
      case 'state.get':
      case 'state.set': {
        const key = String(p.key ?? '')
        if (!key) return err('invalid', 'key: name the value')
        const slot = `${p.scope === 'user' ? viewer.id : ''}\u0000${key}`
        if (method === 'state.get') return ok(state.get(slot) ?? null)
        state.set(slot, p.value ?? null)
        return ok(null)
      }
      case 'subject.get':
        return ok(space.subject ?? null)
      case 'data.call':
        return runData(String(p.fn ?? ''), p.args ?? null)
      default:
        if (method.startsWith('collections.')) return collections(method, p)
        return err('invalid', `Unknown method ${method}.`)
    }
  }

  // ── collections ──────────────────────────────────────────────────────────

  function collections(method: BridgeMethod, p: Record<string, unknown>): BridgeResponse {
    const name = String(p.collection ?? '')
    const spec = tool.facts.collections[name]
    const reading = method === 'collections.list' || method === 'collections.get' || method === 'collections.count'
    const refused = collectionDenial(spec, name, reading ? 'read' : 'insert', viewer)
    if (refused) return err(refused.code, refused.message)
    const held = rows.get(name) ?? []
    rows.set(name, held)
    const own = readsOwnOnly(spec!, viewer)
    const visible = (row: StoredRow) => !own || row.userId === viewer.id
    const where = record(p.where) as Record<string, string | number | boolean | null>
    const problem = queryDenial({ where, ...(typeof p.groupBy === 'string' ? { groupBy: p.groupBy } : {}) })
    if (problem) return err('invalid', problem)
    const now = new Date().toISOString()
    switch (method) {
      case 'collections.insert':
      case 'collections.update': {
        const data = record(p.data)
        const invalid = rowDenial(spec!.schema, data) ?? rowSizeDenial(data)
        if (invalid) return err('invalid', invalid)
        if (method === 'collections.insert') {
          if (held.length >= spec!.maxRows) return err('too_large', `${name} is full: it holds at most ${spec!.maxRows} rows.`)
          const row: StoredRow = { id: randomUUID(), data, userId: viewer.id, createdAt: now, updatedAt: now }
          held.push(row)
          announce([collectionChangePath(name)])
          return ok(rowOf(row))
        }
        const row = held.find((candidate) => candidate.id === p.id)
        if (!row) return err('not_found', `No such row in ${name}.`)
        const denied = collectionDenial(spec, name, 'update', viewer, { mine: row.userId === viewer.id })
        if (denied) return err(denied.code, denied.message)
        row.data = data
        row.updatedAt = now
        announce([collectionChangePath(name)])
        return ok(rowOf(row))
      }
      case 'collections.delete': {
        const at = held.findIndex((candidate) => candidate.id === p.id)
        if (at === -1) return err('not_found', `No such row in ${name}.`)
        const denied = collectionDenial(spec, name, 'delete', viewer, { mine: held[at].userId === viewer.id })
        if (denied) return err(denied.code, denied.message)
        held.splice(at, 1)
        announce([collectionChangePath(name)])
        return ok({ id: p.id })
      }
      case 'collections.get': {
        const row = held.find((candidate) => candidate.id === p.id && visible(candidate))
        return row ? ok(rowOf(row)) : err('not_found', `No such row in ${name}.`)
      }
      case 'collections.list': {
        let found = held.filter((row) => visible(row) && (!p.mine || row.userId === viewer.id) && rowMatches(row.data, where))
        if (p.order === 'desc') found = [...found].reverse()
        const offset = Number(uncursor(p.cursor) ?? 0) || 0
        const limit = Math.min(Math.max(Number(p.limit) || 50, 1), LIST_LIMIT_MAX)
        const page = found.slice(offset, offset + limit)
        return ok({ rows: page.map(rowOf), nextCursor: offset + limit < found.length ? cursorOf(offset + limit) : null })
      }
      case 'collections.count': {
        const found = held.filter((row) => visible(row) && (!p.mine || row.userId === viewer.id) && rowMatches(row.data, where))
        if (typeof p.groupBy !== 'string') return ok({ total: found.length })
        const counts = new Map<string | null, number>()
        for (const row of found) {
          const value = row.data[p.groupBy]
          const key = value === undefined || value === null ? null : String(value)
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        const groups = [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
        return ok({ total: found.length, groups })
      }
    }
    return err('invalid', `Unknown method ${method}.`)
  }

  // ── data.js ──────────────────────────────────────────────────────────────

  async function runData(fn: string, args: unknown): Promise<BridgeResponse> {
    if (!tool.dataBundle.trim()) return err('not_found', `no data.js handler named ${fn} — data.js defines no such handler.`)
    const visvine: Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> = {}
    for (const method of ISOLATE_METHODS) {
      const [family, name] = method.split('.')
      visvine[family] ??= {}
      visvine[family][name] = async (...a: unknown[]) => {
        const response = await handle(method, ISOLATE_PARAMS[method]!(a))
        if (response.ok) return response.value
        throw new Error(response.error.message)
      }
    }
    const context = vm.createContext({
      visvine,
      console,
      subject: space.subject ?? null,
      install: init().install,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(0, ms), 5_000))),
    })
    const source =
      `(async () => { const handlers = Object.create(null), args = ${JSON.stringify(args)};\n${tool.dataBundle}\n` +
      `;if (typeof handlers[${JSON.stringify(fn)}] !== 'function') throw new Error('no data.js handler named ' + ${JSON.stringify(fn)});\n` +
      `return await handlers[${JSON.stringify(fn)}](args, visvine) })()`
    let timer: NodeJS.Timeout | undefined
    try {
      const value = await Promise.race([
        vm.runInContext(source, context, { timeout: BRIDGE_LIMITS.dataCallTimeoutMs, filename: 'data.js' }) as Promise<unknown>,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('__timeout__')), BRIDGE_LIMITS.dataCallTimeoutMs)
        }),
      ])
      return ok(JSON.parse(JSON.stringify(value ?? null)))
    } catch (e) {
      // An error thrown inside the sandbox is that realm's Error, not this one's.
      const message = typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : String(e)
      if (message === '__timeout__') return err('timeout', `data.js handler "${fn}" ran longer than ${BRIDGE_LIMITS.dataCallTimeoutMs / 1000}s and was stopped.`)
      if (message.startsWith('tool perimeter denied:')) return err('perimeter', message)
      if (message.startsWith('no data.js handler named ')) return err('not_found', `${message} — data.js defines no such handler.`)
      return err('invalid', `data.js handler "${fn}" failed: ${message}`)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  function init() {
    const { unbound } = resolved()
    const labels = unbound.map((slot) => tool.facts.bindings[slot]?.label ?? slot)
    return {
      install: { preview: true as const, name: tool.name, settings: settings(), bindings: bindings(), sdk: 2 },
      viewer,
      degraded: labels.length ? { missing: { connectors: [], types: [], agents: [], bindings: labels } } : null,
      subject: space.subject ?? null,
    }
  }

  return {
    async call(method, params) {
      if (!isBridgeMethod(method)) return err('invalid', `Unknown method ${String(method)}.`)
      if (JSON.stringify(params ?? {}).length > BRIDGE_LIMITS.maxParamsBytes) return err('too_large', 'The call is too large.')
      try {
        return await handle(method, params)
      } catch (e) {
        return err('internal', e instanceof Error ? e.message : String(e))
      }
    },
    init,
    setViewer(next) {
      viewer = { ...viewer, ...next }
    },
    setTool(next) {
      tool = next
    },
  }
}
