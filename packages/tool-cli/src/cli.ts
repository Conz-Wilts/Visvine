/**
 * `visvine-tool` — a Visvine Tool built in the author's own editor.
 *
 *   init <folder>   a new Tool from the starter
 *   dev             run it offline, against fixtures/
 *   check           build and check it here, with Visvine's own rules
 *   pack            write its .vvtool
 *   login / logout  sign in to a Visvine server (or out)
 *   whoami, spaces  who the CLI is, and where it may push
 *   push            send it to a space as the working copy
 *   publish         push, then publish a version into that space
 *
 * Offline commands never touch a network. The rest reach one server through
 * its MCP endpoint (./remote.ts), as the signed-in person, as a deploy key
 * (CI), or — against a local development server — as its dev user.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bold, dim, done, fail, green, line, list, red, yellow } from './print'
import { packProject, ProjectError, readProject, releaseNotes } from './project'
import { buildProject, checkProject, describeCheck } from './local'
import { CLI_VERSION, connect, identityFor, RemoteError, type Remote } from './remote'
import { defaultServer, forgetCredentials, originOf } from './credentials'
import { login } from './login'
import { startDev } from './dev/server'

const DEFAULT_SERVER = 'https://visvine.com'
const LINK_FILE = join('.visvine', 'link.json')

interface Args {
  command: string | null
  positional: string[]
  flags: Record<string, string | true>
}

function parse(argv: string[]): Args {
  const out: Args = { command: null, positional: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=', 2)
      if (inline !== undefined) out.flags[key] = inline
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out.flags[key] = argv[++i]
      else out.flags[key] = true
    } else if (arg === '-h') out.flags.help = true
    else if (!out.command) out.command = arg
    else out.positional.push(arg)
  }
  return out
}

const flag = (args: Args, name: string): string | undefined => (typeof args.flags[name] === 'string' ? (args.flags[name] as string) : undefined)

function serverOf(args: Args): string {
  const raw = flag(args, 'server') ?? process.env.VISVINE_SERVER ?? defaultServer() ?? DEFAULT_SERVER
  try {
    return originOf(raw)
  } catch {
    throw new ProjectError(`"${raw}" is not a server address — e.g. https://visvine.com`)
  }
}

function dirOf(args: Args): string {
  return resolve(flag(args, 'dir') ?? '.')
}

const HELP = `${bold('visvine-tool')} ${dim(CLI_VERSION)} — build a Visvine Tool in your own editor

  ${bold('init')} <folder>     a new Tool from the starter
  ${bold('dev')}               run it offline against fixtures/        --port 4800
                    or live in a space, pushed on every save  --space <id>
  ${bold('check')}             build and check it with Visvine's rules  --remote asks the server too
  ${bold('pack')}              write <name>.vvtool                       --out <file>
  ${bold('login')}             sign in                                   --no-browser
  ${bold('logout')}            forget the sign-in
  ${bold('whoami')}            who the CLI is, where
  ${bold('spaces')}            the spaces you can push to
  ${bold('push')}              send it to a space as its working copy    --space <id>
  ${bold('publish')}           push, then publish a version             --space <id> --note <text>

  --server <url>     the Visvine to talk to (VISVINE_SERVER; default ${DEFAULT_SERVER})
  --key <key>        a tool's deploy key, for CI (VISVINE_TOOL_KEY)
  --dir <folder>     the Tool's folder (default: here)
`

// ── offline ──────────────────────────────────────────────────────────────────

function templateDir(): string {
  return fileURLToPath(new URL('./template', import.meta.url))
}

async function cmdInit(args: Args): Promise<number> {
  const target = resolve(args.positional[0] ?? '')
  if (!args.positional[0]) {
    fail('Name the folder: visvine-tool init my-tool')
    return 1
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    fail(`${target} is not empty.`)
    return 1
  }
  const name = basename(target).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'my-tool'
  mkdirSync(target, { recursive: true })
  cpSync(templateDir(), target, { recursive: true })
  const manifestPath = join(target, 'visvine-tool.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  manifest.name = name
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const pkgPath = join(target, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    pkg.name = name
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }
  done(`${name} is ready in ${target}`)
  line(`\n  cd ${args.positional[0]}\n  npm install\n  npx visvine-tool dev\n`)
  return 0
}

async function cmdCheck(args: Args): Promise<number> {
  const dir = dirOf(args)
  const pkg = readProject(dir)
  const build = await buildProject(pkg)
  const report = build.config ? await checkProject(pkg, build) : null
  const result = describeCheck(build, report)
  if (result.errors.length) {
    fail(`${pkg.name} does not pass`)
    list(result.errors, red)
  } else {
    done(`${pkg.name} builds (${Math.round(build.sizeBytes / 1024)} KB) and passes the checks`)
  }
  if (result.warnings.length) list(result.warnings, yellow)
  if (result.flags.length) {
    line(dim('  an admin will be asked about:'))
    list(result.flags, yellow)
  }
  if (args.flags.remote) {
    const remote = await connect(serverOf(args), flag(args, 'key'))
    try {
      const packed = packProject(dir)
      const space = await spaceFor(args, remote, dir)
      const answer = await remote.call<{ ready_to_publish: boolean; build: { errors: string[] }; checks: { blocking: string[]; flags: string[] } }>(
        'check_package',
        { space_id: space, name: packed.name, content_base64: Buffer.from(packed.bytes).toString('base64') },
      )
      if (answer.ready_to_publish) done(`${remote.server} agrees`)
      else {
        fail(`${remote.server} says it does not pass`)
        list([...answer.build.errors, ...answer.checks.blocking], red)
      }
      if (!answer.ready_to_publish) return 1
    } finally {
      await remote.close()
    }
  }
  return result.ok ? 0 : 1
}

async function cmdPack(args: Args): Promise<number> {
  const dir = dirOf(args)
  const packed = packProject(dir)
  const out = resolve(flag(args, 'out') ?? `${packed.name}.vvtool`)
  writeFileSync(out, packed.bytes)
  done(`${out} ${dim(`${packed.files.length} files · sha256 ${packed.digest.slice(0, 12)}`)}`)
  return 0
}

/**
 * `dev --space <id>`: live against a real space instead of fixtures — every
 * save is pushed, and the space's own preview shows it, reading the space's
 * data through the server under the author's own grants.
 */
async function devLive(args: Args): Promise<number> {
  const dir = dirOf(args)
  const remote = await connect(serverOf(args), flag(args, 'key'))
  const first = await push(args, remote)
  if (first && !args.flags['no-browser']) openLink(first.answer.preview_url)
  let timer: NodeJS.Timeout | null = null
  let running = Promise.resolve()
  const watcher = watch(dir, { recursive: true }, (_event, file) => {
    const path = String(file ?? '').split('\\').join('/')
    if (!(path === 'visvine-tool.json' || path.startsWith('src/') || ['README.md', 'CHANGELOG.md', 'icon.svg'].includes(path))) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      running = running.then(() => push(args, remote).then(() => undefined, (err: Error) => fail(err.message)))
    }, 300)
  })
  done(`Pushing ${bold(dir)} on every save. Ctrl-C to stop.`)
  await new Promise<void>((resolveStop) => {
    const stop = () => {
      watcher.close()
      resolveStop()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await running
  await remote.close()
  return 0
}

function openLink(url: string): void {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // The link was printed with the push.
  }
}

async function cmdDev(args: Args): Promise<number> {
  if (flag(args, 'space')) return devLive(args)
  const dir = dirOf(args)
  const port = Number(flag(args, 'port') ?? 4800)
  const dev = await startDev(dir, { port, print: (text) => line(dim(text)) })
  done(`${bold(dev.url)} — offline, against fixtures/. Ctrl-C to stop.`)
  await new Promise<void>((resolveStop) => {
    const stop = () => {
      dev.close()
      resolveStop()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  return 0
}

// ── the server ───────────────────────────────────────────────────────────────

async function cmdLogin(args: Args): Promise<number> {
  const server = serverOf(args)
  const result = await login(server, { browser: !args.flags['no-browser'], print: (text) => line(text) })
  done(`Signed in to ${server}${result.scope ? dim(` · ${result.scope}`) : ''}`)
  return 0
}

async function cmdLogout(args: Args): Promise<number> {
  const server = serverOf(args)
  if (forgetCredentials(server)) done(`Signed out of ${server}`)
  else line(`Not signed in to ${server}`)
  return 0
}

interface SpaceRow {
  id: string
  name: string
}

async function listSpaces(remote: Remote): Promise<{ you: { name: string; email: string }; spaces: SpaceRow[] }> {
  return remote.call('list_spaces', {})
}

async function cmdWhoami(args: Args): Promise<number> {
  const server = serverOf(args)
  const identity = identityFor(server, flag(args, 'key'))
  if (identity.kind === 'key') {
    line(`A deploy key, on ${server}`)
    return 0
  }
  const remote = await connect(server, flag(args, 'key'))
  try {
    const { you, spaces } = await listSpaces(remote)
    line(`${you.name} ${dim(`<${you.email}>`)} on ${server}${identity.kind === 'none' ? dim(' (a local server, no sign-in)') : ''}`)
    line(dim(`${spaces.length} space${spaces.length === 1 ? '' : 's'}`))
  } finally {
    await remote.close()
  }
  return 0
}

async function cmdSpaces(args: Args): Promise<number> {
  const remote = await connect(serverOf(args), flag(args, 'key'))
  try {
    const { spaces } = await listSpaces(remote)
    for (const space of spaces) line(`${space.id}  ${dim(space.name)}`)
  } finally {
    await remote.close()
  }
  return 0
}

/** The space a push goes to: named, remembered for this folder, or the only one there is. */
async function spaceFor(args: Args, remote: Remote, dir: string): Promise<string> {
  const named = flag(args, 'space') ?? process.env.VISVINE_SPACE
  if (named) return named
  const link = join(dir, LINK_FILE)
  if (existsSync(link)) {
    const saved = JSON.parse(readFileSync(link, 'utf8')) as { server?: string; space?: string }
    if (saved.space && saved.server === remote.server) return saved.space
  }
  if (remote.identity === 'key') throw new ProjectError('Name the space: --space <id>, or VISVINE_SPACE.')
  const { spaces } = await listSpaces(remote)
  if (spaces.length === 1) return spaces[0].id
  throw new ProjectError(
    spaces.length === 0
      ? 'You are in no space on this server yet.'
      : `Name the space: --space <id>\n${spaces.map((s) => `  ${s.id}  ${s.name}`).join('\n')}`,
  )
}

function remember(dir: string, server: string, space: string): void {
  mkdirSync(join(dir, '.visvine'), { recursive: true })
  writeFileSync(join(dir, LINK_FILE), `${JSON.stringify({ server, space }, null, 2)}\n`)
}

interface PushAnswer {
  name: string
  created: boolean
  changed: string[]
  removed: string[]
  build: { ok: boolean; errors: string[]; warnings: string[] }
  preview_url: string
}

async function push(args: Args, remote: Remote): Promise<{ space: string; answer: PushAnswer } | null> {
  const dir = dirOf(args)
  const packed = packProject(dir)
  const space = await spaceFor(args, remote, dir)
  const answer = await remote.call<PushAnswer>('push_tool', {
    space_id: space,
    name: packed.name,
    content_base64: Buffer.from(packed.bytes).toString('base64'),
  })
  remember(dir, remote.server, space)
  const what = answer.created ? 'made' : answer.changed.length + answer.removed.length ? `${[...answer.changed, ...answer.removed.map((f) => `−${f}`)].join(', ')}` : 'nothing changed'
  if (answer.build.ok) done(`${answer.name} pushed to ${space} ${dim(`(${what})`)}`)
  else {
    fail(`${answer.name} pushed to ${space}, and does not build there`)
    list(answer.build.errors, red)
  }
  if (answer.build.warnings.length) list(answer.build.warnings, yellow)
  line(`  ${answer.preview_url}`)
  return answer.build.ok ? { space, answer } : null
}

async function cmdPush(args: Args): Promise<number> {
  const remote = await connect(serverOf(args), flag(args, 'key'))
  try {
    return (await push(args, remote)) ? 0 : 1
  } finally {
    await remote.close()
  }
}

async function cmdPublish(args: Args): Promise<number> {
  const remote = await connect(serverOf(args), flag(args, 'key'))
  try {
    const pushed = await push(args, remote)
    if (!pushed) return 1
    const notes = releaseNotes(dirOf(args))
    const published = await remote.call<{ version: number; status: string; next?: string }>('publish_tool', {
      space_id: pushed.space,
      name: pushed.answer.name,
      ...(flag(args, 'note') ? { note: flag(args, 'note') } : {}),
      ...(notes ? { release_notes: notes } : {}),
    })
    if (published.status === 'approved') done(`v${published.version} published and approved in ${pushed.space}`)
    else done(`v${published.version} published — ${green('waiting for a space admin')} to approve it`)
    return 0
  } finally {
    await remote.close()
  }
}

// ── the door ─────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, (args: Args) => Promise<number>> = {
  init: cmdInit,
  dev: cmdDev,
  check: cmdCheck,
  pack: cmdPack,
  login: cmdLogin,
  logout: cmdLogout,
  whoami: cmdWhoami,
  spaces: cmdSpaces,
  push: cmdPush,
  publish: cmdPublish,
}

async function main(argv: string[]): Promise<number> {
  const args = parse(argv)
  if (args.flags.version || args.command === 'version') {
    line(CLI_VERSION)
    return 0
  }
  if (!args.command || args.flags.help || args.command === 'help') {
    line(HELP)
    return args.command || args.flags.help ? 0 : 1
  }
  const run = COMMANDS[args.command]
  if (!run) {
    fail(`No command "${args.command}".`)
    line(HELP)
    return 1
  }
  try {
    return await run(args)
  } catch (err) {
    if (err instanceof ProjectError || err instanceof RemoteError) fail(err.message)
    else fail(err instanceof Error ? (err.stack ?? err.message) : String(err))
    return 1
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
})
