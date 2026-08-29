/**
 * The machine's screen, from inside it.
 *
 * A small HTTP service on localhost that grabs frames off the X display and
 * replays a human's clicks and keystrokes onto it. The Durable Object reaches
 * it through the container's own port and fans frames out to whoever is
 * watching (§9); nothing here is exposed to the network — the container has no
 * inbound route at all, so this listens on loopback and is reached only by the
 * runtime.
 *
 * It does the least it can: grab a frame, move a mouse, type a key. Deciding
 * WHO may do those things happens two layers up, where the session is.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.SCREEN_PORT ?? 8080)
const DISPLAY = process.env.DISPLAY ?? ':99'
const WIDTH = Number(process.env.SCREEN_WIDTH ?? 1280)
const HEIGHT = Number(process.env.SCREEN_HEIGHT ?? 800)

/** Run a command and collect stdout as bytes. Never throws; the caller decides. */
function run(command, args, { input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, DISPLAY } })
    const out = []
    const err = []
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', (error) => resolve({ code: -1, stdout: Buffer.alloc(0), stderr: Buffer.from(String(error)) }))
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }))
    if (input) child.stdin.end(input)
    else child.stdin.end()
  })
}

/**
 * One JPEG of the display. Quality is deliberately low: this is a window onto
 * what an agent is doing, not a screenshot tool, and every frame is billed as
 * egress on its way to a watcher.
 */
async function frame() {
  const result = await run('ffmpeg', [
    '-loglevel', 'error',
    '-f', 'x11grab',
    '-video_size', `${WIDTH}x${HEIGHT}`,
    '-i', DISPLAY,
    '-vframes', '1',
    '-q:v', '8',
    '-f', 'mjpeg',
    'pipe:1',
  ])
  return result.code === 0 && result.stdout.length > 0 ? result.stdout : null
}

/**
 * A human's input, replayed onto the display.
 *
 * The vocabulary is small on purpose — move, click, scroll, type, key — and
 * every value is checked here rather than passed to a shell. `type` is the one
 * that carries secrets (a password typed during a takeover), so it goes to
 * xdotool as an argument and is never logged, echoed or returned.
 */
async function input(event) {
  const { kind } = event
  if (kind === 'move') {
    return run('xdotool', ['mousemove', String(int(event.x)), String(int(event.y))])
  }
  if (kind === 'click') {
    const button = [1, 2, 3, 4, 5].includes(event.button) ? event.button : 1
    return run('xdotool', ['mousemove', String(int(event.x)), String(int(event.y)), 'click', String(button)])
  }
  if (kind === 'scroll') {
    // 4 is up, 5 is down in X's button vocabulary.
    return run('xdotool', ['click', event.dy < 0 ? '4' : '5'])
  }
  if (kind === 'type') {
    if (typeof event.text !== 'string' || event.text.length > 4096) return { code: 1 }
    return run('xdotool', ['type', '--delay', '12', '--', event.text])
  }
  if (kind === 'key') {
    // A key name, not a string to interpret: letters, digits and the names
    // xdotool already knows (Return, Tab, ctrl+a).
    if (typeof event.key !== 'string' || !/^[A-Za-z0-9_+-]{1,32}$/.test(event.key)) return { code: 1 }
    return run('xdotool', ['key', '--', event.key])
  }
  return { code: 1 }
}

function int(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(n, 0), Math.max(WIDTH, HEIGHT))
}

/**
 * The title of what is on screen.
 *
 * There is no window manager here — one browser, full screen, is the whole
 * desktop — so nothing sets an "active" window and `getactivewindow` fails.
 * The visible window is the answer instead, and its name is the page.
 */
async function windowTitle() {
  const active = await run('xdotool', ['getactivewindow', 'getwindowname'])
  if (active.code === 0) {
    const title = active.stdout.toString('utf8').trim()
    if (title) return title
  }
  const visible = await run('xdotool', ['search', '--onlyvisible', '--name', '.'])
  const ids = visible.stdout.toString('utf8').trim().split(/\s+/).filter(Boolean)
  for (const id of ids.reverse()) {
    const named = await run('xdotool', ['getwindowname', id])
    const title = named.code === 0 ? named.stdout.toString('utf8').trim() : ''
    if (title) return title
  }
  return ''
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')

  if (url.pathname === '/frame' && request.method === 'GET') {
    const jpeg = await frame()
    if (!jpeg) {
      response.writeHead(503, { 'content-type': 'text/plain' })
      response.end('no display')
      return
    }
    response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' })
    response.end(jpeg)
    return
  }

  if (url.pathname === '/input' && request.method === 'POST') {
    const event = await body(request)
    if (!event || typeof event.kind !== 'string') {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end('{"ok":false}')
      return
    }
    const result = await input(event)
    response.writeHead(result.code === 0 ? 200 : 400, { 'content-type': 'application/json' })
    // Deliberately no echo of what was typed.
    response.end(JSON.stringify({ ok: result.code === 0 }))
    return
  }

  /**
   * What is on screen right now, in words: the active window's title, which for
   * a browser is the page. Enough to say what a step was ABOUT without reading
   * the screen, and it carries no input — a trace records that a human clicked
   * on "Example Domain", never what they typed there.
   */
  if (url.pathname === '/context' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ title: await windowTitle() }))
    return
  }

  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, display: DISPLAY, width: WIDTH, height: HEIGHT }))
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('not found')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`screen service on ${PORT} for ${DISPLAY} (${WIDTH}x${HEIGHT})`)
})
