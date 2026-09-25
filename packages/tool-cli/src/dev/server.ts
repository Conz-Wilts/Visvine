/**
 * `visvine-tool dev`: the Tool running on the author's machine, offline — in
 * the frame Visvine serves it in, under the same Content-Security-Policy, on
 * the same kit, with its bridge answered from `fixtures/` by the offline
 * runtime (@visvine/tool-kit/mock) under the same gates.
 *
 * Two origins, as in production: the host page on `localhost`, the frame on
 * `127.0.0.1` — a sandboxed iframe with no same-origin, so the Tool reaches
 * nothing but the host's messages, exactly as it will inside Visvine.
 *
 *   /                 the host page — the Tool, the kit's components, the calls
 *   /__state          what the host needs: the build, the handshake, the theme
 *   /__bridge         a bridge call, answered from fixtures (host only)
 *   /__viewer         look as another person — `{ id }` of one space.json
 *                     names — or as an admin or not (`{ isAdmin }`)
 *   /__events         rebuilds, changed paths and calls, as they happen
 *   /__frame          the frame document                     (frame origin)
 *   /__bundle.js      the compiled Tool, or the gallery       (frame origin)
 *   /__vendor/<file>  React, the kit and its stylesheet       (frame origin)
 *
 * Every save rebuilds with the server's own compiler and the page reloads the
 * frame; a change to fixtures/ starts the space again.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createMockBridge, loadFixtures, type MockBridge } from '@visvine/tool-kit/mock'
import { renderFrameDocument } from '@/lib/tools/frameDocument'
import { frameCsp, frameHeaders } from '@/lib/tools/csp'
import { compileToolUi } from '@/lib/tools/compile'
import { manifestOf } from '@/lib/tools/config'
import { toolDiagnosticLine, type BuiltTool } from '@/lib/tools/buildSources'
import { factsFromPerimeter } from '@visvine/tool-protocol/manifest'
import { EMPTY_PERIMETER } from '@visvine/tool-protocol/perimeter'
import { readProject } from '../project'
import { buildProject } from '../local'
import { GALLERY_SOURCE } from './gallery'

export interface DevServer {
  url: string
  close(): void
}

interface Built {
  name: string
  title: string
  build: BuiltTool | null
  /** A project that could not even be read — the manifest, most often. */
  problem: string | null
  version: string
}

const VENDOR_TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

/** Where @visvine/tool-kit's runtime files are — built beside the kit, served as-is. */
function runtimeDir(): string {
  const require = createRequire(import.meta.url)
  const dir = join(dirname(require.resolve('@visvine/tool-kit/package.json')), 'runtime')
  if (!existsSync(join(dir, 'tool-kit.js'))) {
    throw new Error(`@visvine/tool-kit has no runtime/ at ${dir} — reinstall it.`)
  }
  return dir
}

function hostAsset(file: string): string {
  return readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 2_000_000) throw new Error('too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export async function startDev(dir: string, opts: { port: number; print: (line: string) => void }): Promise<DevServer> {
  const vendor = runtimeDir()
  const hostOrigin = `http://localhost:${opts.port}`
  const frameOrigin = `http://127.0.0.1:${opts.port}`

  let current: Built = { name: 'tool', title: 'Tool', build: null, problem: null, version: '0' }
  let bridge: MockBridge | null = null
  let gallery: string | null = null
  const streams = new Set<ServerResponse>()
  const send = (event: string, data: unknown) => {
    for (const res of streams) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const toolOf = (built: Built) => ({
    name: built.name,
    title: built.title,
    facts: built.build?.config ? manifestOf(built.build.config) : factsFromPerimeter(EMPTY_PERIMETER),
    dataBundle: built.build?.dataBundle ?? '',
  })

  const rebuild = async (): Promise<void> => {
    let next: Built
    try {
      const pkg = readProject(dir)
      const build = await buildProject(pkg)
      next = { name: pkg.name, title: pkg.config.title, build, problem: null, version: randomBytes(4).toString('hex') }
      if (build.ok) opts.print(`built ${pkg.name} (${Math.round(build.sizeBytes / 1024)} KB)`)
      else for (const d of build.errors) opts.print(`  ${toolDiagnosticLine(d)}`)
    } catch (err) {
      next = { ...current, build: null, problem: (err as Error).message, version: randomBytes(4).toString('hex') }
      opts.print(`  ${next.problem}`)
    }
    current = next
    if (bridge) bridge.setTool(toolOf(current))
    send('build', { version: current.version })
  }

  let viewers: Array<{ id: string; name: string; isAdmin: boolean }> = []
  const startSpace = (): void => {
    const space = loadFixtures(join(dir, 'fixtures'))
    const viewer = bridge?.init().viewer
    viewers = space.viewers
    bridge = createMockBridge({ tool: toolOf(current), space, onChange: (paths) => send('changed', { paths }) })
    if (viewer && viewers.some((v) => v.id === viewer.id)) bridge.setViewer(viewer)
  }

  await rebuild()
  startSpace()
  const compiledGallery = await compileToolUi(GALLERY_SOURCE, { dependencies: [] })
  gallery = compiledGallery.ok ? compiledGallery.bundle : null

  const frameDocument = (kind: 'tool' | 'gallery') => {
    const nonce = randomBytes(18).toString('base64url')
    const html = renderFrameDocument({
      selfOrigin: frameOrigin,
      appOrigin: hostOrigin,
      bundleUrl: `${frameOrigin}/__bundle.js?kind=${kind}&v=${current.version}`,
      vendorBase: `${frameOrigin}/__vendor`,
      nonce,
      kit: 2,
    })
    return { html, csp: frameCsp({ appOrigin: hostOrigin, selfOrigin: frameOrigin, nonce }) }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', hostOrigin)
    const onFrameOrigin = (req.headers.host ?? '').startsWith('127.0.0.1')
    try {
      // ── the frame's origin ──
      if (url.pathname === '/__frame') {
        if (!onFrameOrigin) return void res.writeHead(404).end()
        const doc = frameDocument(url.searchParams.get('kind') === 'gallery' ? 'gallery' : 'tool')
        res.writeHead(200, frameHeaders(doc.csp)).end(doc.html)
        return
      }
      if (url.pathname === '/__bundle.js') {
        const code = url.searchParams.get('kind') === 'gallery' ? gallery : current.build?.ok ? current.build.uiBundle : null
        res.writeHead(code ? 200 : 404, { 'Content-Type': 'text/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
        res.end(code ?? '')
        return
      }
      if (url.pathname.startsWith('/__vendor/')) {
        const file = url.pathname.slice('/__vendor/'.length)
        const path = join(vendor, file)
        if (!/^[a-z0-9.-]+$/.test(file) || !existsSync(path)) return void res.writeHead(404).end()
        res.writeHead(200, {
          'Content-Type': VENDOR_TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        })
        res.end(readFileSync(path))
        return
      }
      if (onFrameOrigin) return void res.writeHead(404).end()

      // ── the host's origin ──
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(hostAsset('host.html'))
        return
      }
      if (url.pathname === '/__host.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(hostAsset('host.js'))
        return
      }
      if (url.pathname === '/__state') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(
          JSON.stringify({
            name: current.name,
            title: current.title,
            version: current.version,
            problem: current.problem,
            build: current.build
              ? { ok: current.build.ok, errors: current.build.errors.map(toolDiagnosticLine), warnings: current.build.warnings.map(toolDiagnosticLine), configError: current.build.configError }
              : null,
            init: bridge?.init() ?? null,
            viewers,
            nav: current.build?.config?.surfaces.nav ?? null,
            mayDownload: current.build?.config ? manifestOf(current.build.config).permissions.ui.download : false,
            frameUrl: `${frameOrigin}/__frame?kind=tool&v=${current.version}`,
            galleryUrl: gallery ? `${frameOrigin}/__frame?kind=gallery&v=${current.version}` : null,
          }),
        )
        return
      }
      if (url.pathname === '/__events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(': connected\n\n')
        streams.add(res)
        const beat = setInterval(() => res.write(': keepalive\n\n'), 20_000)
        req.on('close', () => {
          clearInterval(beat)
          streams.delete(res)
        })
        return
      }
      if (req.method === 'POST' && (url.pathname === '/__bridge' || url.pathname === '/__viewer')) {
        // Only this page's own scripts: a custom header no other site can send without a preflight.
        const origin = req.headers.origin
        if (req.headers['x-visvine-dev'] !== '1' || (origin && origin !== hostOrigin)) return void res.writeHead(403).end()
        const body = (await readBody(req)) as { method?: string; params?: unknown; id?: string; isAdmin?: boolean; name?: string }
        if (!bridge) return void res.writeHead(503).end()
        if (url.pathname === '/__viewer') {
          // One of the people fixtures/space.json names, or the one looking now as an admin or not.
          const named = typeof body.id === 'string' ? viewers.find((v) => v.id === body.id) : undefined
          if (typeof body.id === 'string' && !named) return void res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`No viewer "${body.id}" in fixtures/space.json`)
          bridge.setViewer(named ?? { ...(typeof body.isAdmin === 'boolean' ? { isAdmin: body.isAdmin } : {}), ...(typeof body.name === 'string' ? { name: body.name } : {}) })
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(bridge.init()))
          return
        }
        const answer = await bridge.call(String(body.method), body.params)
        send('call', { method: body.method, ok: answer.ok, ...(answer.ok ? {} : { code: answer.error.code, message: answer.error.message }) })
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer))
        return
      }
      res.writeHead(404).end()
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end((err as Error).message)
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, resolve)
  })

  let pending: NodeJS.Timeout | null = null
  let fixturesChanged = false
  const watchers: FSWatcher[] = []
  const onChange = (file: string | null) => {
    const path = (file ?? '').split('\\').join('/')
    if (path.startsWith('node_modules') || path.startsWith('.') || path.includes('/.')) return
    if (path.startsWith('fixtures')) fixturesChanged = true
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = null
      void rebuild().then(() => {
        if (fixturesChanged) {
          fixturesChanged = false
          startSpace()
          send('build', { version: current.version })
        }
      })
    }, 120)
  }
  try {
    watchers.push(watch(dir, { recursive: true }, (_event, file) => onChange(file)))
  } catch {
    // A platform without recursive watching: the sources and fixtures by folder.
    for (const sub of ['.', 'src', 'fixtures', 'fixtures/notes']) {
      const path = join(dir, sub)
      if (existsSync(path)) watchers.push(watch(path, (_event, file) => onChange(sub === '.' ? file : `${sub}/${file ?? ''}`)))
    }
  }

  return {
    url: hostOrigin,
    close() {
      for (const w of watchers) w.close()
      for (const res of streams) res.end()
      server.close()
    },
  }
}
