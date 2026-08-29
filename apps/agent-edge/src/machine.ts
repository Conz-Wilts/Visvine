/**
 * One agent's machine.
 *
 * A Durable Object that owns a container, the egress policy that container is
 * held to, and (later) the window relayed off it. One object per (space,
 * agent): the space is the security boundary and a machine never crosses it.
 *
 * The two lines that make this safe are in `boot()`:
 *
 *   • `enableInternet: false` — the container has no route to the internet at
 *     all. Not a filtered one; none. Anything the policy does not open, and
 *     any protocol the handler cannot read, has nowhere to go.
 *   • `interceptAllOutboundHttp(egress)` — every HTTP request it does make is
 *     handed to our own Worker entrypoint, which evaluates the policy, injects
 *     credentials the container cannot read, and records what happened.
 *
 * The disk is ephemeral: a container that stops wakes from its image with
 * nothing on it. `/workspace` survives because it is archived to R2 before the
 * machine sleeps and unpacked again when it next starts — so the rule an agent
 * has to hold is simply "keep it in /workspace", and everything else is scratch.
 *
 * (The runtime's own directory snapshots would be the cheaper mechanism and are
 * refused on this account — "the container does not meet the required snapshot
 * prerequisites" — so the archive is what actually works. R2 also survives the
 * machine being destroyed and rebuilt, which a snapshot tied to a container
 * does not.)
 */
import { DurableObject } from 'cloudflare:workers'
import type { VmPolicy } from '@visvine/vm-policy'
import { clipText, EventStream, type VmEvent } from './events'
import { MIN_REDACTED_CHARS, scrub } from './redact'
import type { Env } from './index'

/** What the control plane hands down when it leases a machine. */
export interface LeaseSpec {
  /** Which world this machine belongs to. Handed down; never decided here. */
  environment: string
  spaceId: string
  agentName: string
  policy: VmPolicy
  /** Instance shape. `standard-3` is the agent default; `standard-4` the ceiling. */
  instanceType: 'lite' | 'standard-1' | 'standard-2' | 'standard-3' | 'standard-4'
  /** R2 prefix for the space's shared volume. */
  workspaceKey: string
  /** Minutes of inactivity before the platform stops the container. */
  idleMinutes: number
}

export interface ExecRequest {
  cmd: string[]
  /** The run this command belongs to, so the timeline can be scrubbed by run. */
  runId?: string
  /** Seconds. A run that outlives this is killed rather than left holding the machine. */
  timeoutSeconds?: number
}

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

const DEFAULT_EXEC_TIMEOUT_SECONDS = 120
/** Where work survives. Everything outside this is thrown away at every sleep. */
const WORKSPACE = '/workspace'
/**
 * Snapshot this long before the platform's own idle stop. The platform gives no
 * warning when it stops a container, so the machine takes its own snapshot a
 * minute early rather than discovering afterwards that it had none.
 */
const SNAPSHOT_LEAD_MS = 60_000
/**
 * Nothing an agent asks for runs as root. The runtime's exec declares a `user`
 * option but refuses it, so dropping privileges is the command's own first act.
 */
const AGENT_USER = 'agent'
/** Where the in-container screen service listens. Loopback only; no inbound route exists. */
const SCREEN_PORT = 8080
/**
 * Frames per second while somebody is watching. Deliberately low: this is a
 * window onto what an agent is doing, not a video call, and every frame is
 * billed as egress on its way out.
 */
const FRAME_INTERVAL_MS = 600
/** A demonstration long enough to need more than this is two demonstrations. */
const MAX_TRACE_STEPS = 200

/** One step of a demonstration. Never carries what was typed. */
interface TraceStep {
  at: string
  kind: string
  /** The title of whatever was on screen — for a browser, the page. */
  where: string
  x?: number
  y?: number
  key?: string
  /** That typing happened, and how much. Not the text. */
  typedChars?: number
}

/**
 * The machine's environment, in one place because it is needed in two and
 * inherited in neither.
 *
 * `container.start({ env })` REPLACES what the image declared rather than
 * adding to it, and `container.exec` inherits nothing from the running
 * process — so a variable that is not here does not exist for anything the
 * machine runs. Playwright's browser path is the one that bites: without it
 * Chromium is installed and unreachable, and the error says to install it again.
 */
function machineEnv(spec: LeaseSpec): Record<string, string> {
  return {
    VISVINE_SPACE: spec.spaceId,
    VISVINE_AGENT: spec.agentName,
    VISVINE_WORKSPACE: spec.workspaceKey,
    DISPLAY: ':99',
    SCREEN_WIDTH: '1280',
    SCREEN_HEIGHT: '800',
    PLAYWRIGHT_BROWSERS_PATH: '/opt/playwright',
    NODE_PATH: '/usr/local/lib/node_modules',
    BROWSER_PROFILE: `${WORKSPACE}/.browser`,
    // The interception CA is in the system bundle; anything that reads a CA out
    // of the environment has to be pointed at the same file.
    NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca-certificates.crt',
    SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt',
    REQUESTS_CA_BUNDLE: '/etc/ssl/certs/ca-certificates.crt',
    CURL_CA_BUNDLE: '/etc/ssl/certs/ca-certificates.crt',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/home/agent',
  }
}

function asAgent(cmd: readonly string[]): string[] {
  return ['setpriv', `--reuid=${AGENT_USER}`, `--regid=${AGENT_USER}`, '--init-groups', ...cmd]
}

/** The container hands back bytes; the transcript wants text. */
function decode(buffer: ArrayBuffer | null | undefined): string {
  return buffer ? new TextDecoder().decode(buffer) : ''
}

export class AgentMachine extends DurableObject<Env> {
  /**
   * Live while this object is. A machine that sleeps and wakes starts a new
   * stream, which is right: the timeline is per boot, and the record of the
   * previous one is already with the control plane.
   */
  private readonly stream = new EventStream((events) => {
    this.ctx.waitUntil(this.reportEvents(events))
  })

  /**
   * True while a human holds the keyboard. Input is refused otherwise.
   *
   * `typed` is held IN MEMORY for the life of the takeover and never recorded,
   * emitted or persisted. It exists for one reason: a browser puts what you type
   * into the window title, so the titles this trace records have to be scrubbed
   * of it. Without this, typing a password into an address bar writes it into
   * the demonstration — which is precisely what a takeover exists to prevent.
   */
  private takeover: { by: string; since: number; steps: TraceStep[]; typed: string[] } | null = null
  private streaming = false

  private async spec(): Promise<LeaseSpec | null> {
    return (await this.ctx.storage.get<LeaseSpec>('spec')) ?? null
  }

  /**
   * Take (or refresh) the lease. Idempotent: the control plane's tick and a
   * request that wants the machine can both call this, and the second one
   * finds a running container rather than starting a second.
   */
  async lease(spec: LeaseSpec): Promise<{ running: boolean; booted: boolean }> {
    await this.ctx.storage.put('spec', spec)
    const container = this.ctx.container
    if (!container) throw new Error('this Durable Object has no container binding')
    if (container.running) return { running: true, booted: false }
    await this.boot(spec, container)
    return { running: true, booted: true }
  }

  private async boot(spec: LeaseSpec, container: Container): Promise<void> {
    container.start({
      enableInternet: false,
      instance: spec.instanceType,
      env: machineEnv(spec),
    })

    await this.intercept(container, spec)

    // The platform's own idle timer, which is what actually stops the machine.
    // The control-plane tick reaps the lease row; it is not what saves the money.
    await container.setInactivityTimeout(spec.idleMinutes * 60_000)
    const restored = await this.restoreWorkspace(container, spec)
    await this.armSnapshot(spec)
    this.stream.emit('boot', { instanceType: spec.instanceType, workspaceRestored: restored })
    this.stream.flush()
  }

  /** Where this machine's workspace archive lives. Under the SPACE's prefix. */
  private archiveKey(spec: LeaseSpec): string {
    return `${spec.workspaceKey}/agents/${spec.agentName}.tar.gz`
  }

  /**
   * Unpack the workspace the machine last saved. Absent is not an error: a new
   * machine starts with an empty one, which is what a first run should see.
   */
  private async restoreWorkspace(container: Container, spec: LeaseSpec): Promise<boolean> {
    const archive = await this.env.WORKSPACES.get(this.archiveKey(spec))
    if (!archive?.body) return false
    try {
      // Unpacked as root so ownership can be restored with it, then handed back
      // to the agent user — a workspace the agent cannot write to is worse than
      // an empty one.
      const process = await container.exec(
        ['sh', '-c', `cd ${WORKSPACE} && tar -xzf - && chown -R ${AGENT_USER}:${AGENT_USER} ${WORKSPACE}`],
        { stdin: archive.body },
      )
      const code = await process.exitCode
      if (code !== 0) console.error('workspace restore exited', code)
      return code === 0
    } catch (err) {
      // A machine that could not restore is still a working machine — it just
      // starts empty, which the agent will notice long before we do.
      console.error('workspace restore failed', err)
      this.stream.emit('error', { message: 'the workspace could not be restored' })
      return false
    }
  }

  /**
   * Schedule the workspace snapshot just before the platform would stop the
   * machine. Re-armed on every command, so an active machine keeps pushing it
   * out and an idle one takes its snapshot once.
   */
  private async armSnapshot(spec: LeaseSpec): Promise<void> {
    const at = Date.now() + Math.max(spec.idleMinutes * 60_000 - SNAPSHOT_LEAD_MS, 30_000)
    await this.ctx.storage.setAlarm(at)
  }

  /** The alarm: take the snapshot the next boot restores from. */
  override async alarm(): Promise<void> {
    await this.snapshotWorkspace()
  }

  private async snapshotWorkspace(): Promise<void> {
    const container = this.ctx.container
    if (!container?.running) return
    const spec = await this.spec()
    if (!spec) return
    try {
      const process = await container.exec(['sh', '-c', `cd ${WORKSPACE} && tar -czf - . 2>/dev/null`])
      const output = await process.output()
      // An empty workspace still archives (tar of nothing), and writing it is
      // what makes "the agent deleted everything" survive a sleep too.
      await this.env.WORKSPACES.put(this.archiveKey(spec), output.stdout)
    } catch (err) {
      // A machine that could not save is still a working machine; what it loses
      // is the work in progress, which is worth a log and not a crash.
      console.error('workspace save failed', err)
    }
  }

  /**
   * Point the container's egress at our entrypoint.
   *
   * Two calls, because the runtime treats the two protocols differently:
   *
   *   • `interceptAllOutboundHttp` is a catch-all, so every plain-HTTP request
   *     is judged — which in practice means refused, since policy is HTTPS-only.
   *   • HTTPS is registered PER HOST, so only the hosts the policy allows are
   *     routable at all. Anything else has no route (`enableInternet: false`)
   *     and fails closed rather than reaching us to be refused.
   *
   * A wildcard cannot be registered, because there is no host to name. A policy
   * of `*.example.com` therefore grants nothing over HTTPS — the safe direction,
   * and the reason a space's connectors should name the hosts they actually use.
   */
  private async intercept(container: Container, spec: LeaseSpec): Promise<void> {
    // `props` is how per-container context reaches a loopback binding: the
    // entrypoint is one class shared by every machine, so without it the handler
    // would not know whose request it is holding.
    const egress = this.ctx.exports.EgressProxy({
      props: {
        environment: spec.environment,
        spaceId: spec.spaceId,
        agentName: spec.agentName,
        machineId: this.ctx.id.toString(),
      },
    })
    await container.interceptAllOutboundHttp(egress)
    for (const host of spec.policy.allow) {
      if (host.includes('*')) continue
      await container.interceptOutboundHttps(host, egress)
    }
  }

  /** The current policy, read by the egress entrypoint on every request. */
  async policy(): Promise<VmPolicy | null> {
    return (await this.spec())?.policy ?? null
  }

  /** Narrow (never widen) the policy of a machine that is already running. */
  async setPolicy(policy: VmPolicy): Promise<void> {
    const spec = await this.spec()
    if (!spec) throw new Error('this machine has no lease')
    const next = { ...spec, policy }
    await this.ctx.storage.put('spec', next)
    // A running machine's routes have to follow its policy, or narrowing would
    // change what the handler says while leaving the old hosts reachable.
    const container = this.ctx.container
    if (container?.running) await this.intercept(container, next)
  }

  async exec(request: ExecRequest): Promise<ExecResult> {
    const container = this.ctx.container
    if (!container) throw new Error('this Durable Object has no container binding')
    if (!container.running) {
      const spec = await this.spec()
      if (!spec) throw new Error('this machine has no lease')
      // A wake is a fresh boot with a fresh disk. Nothing here restores state:
      // what survives is in the workspace, by construction.
      await this.boot(spec, container)
    }

    // Never as root, and always in the workspace: the entrypoint drops
    // privileges for the machine's own life, and this is the other half of it.
    // Never as root and always in the workspace: root inside a container that is
    // its own VM is contained either way, but a command that cannot write
    // outside /workspace and /home is a smaller blast radius for a
    // prompt-injected agent.
    this.stream.emit('exec', { cmd: request.cmd, runId: request.runId ?? null })
    const spec = await this.spec()
    const process = await container.exec(asAgent(request.cmd), {
      cwd: WORKSPACE,
      ...(spec ? { env: machineEnv(spec) } : {}),
    })
    const timeout = (request.timeoutSeconds ?? DEFAULT_EXEC_TIMEOUT_SECONDS) * 1000
    const timedOut = await Promise.race([
      process.exitCode.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeout)),
    ])
    // Work happened, so push the snapshot out rather than taking one mid-run.
    if (spec) await this.armSnapshot(spec)

    if (timedOut) {
      process.kill()
      this.stream.emit('exit', { exitCode: -1, timedOut: true })
      this.stream.flush()
      return { exitCode: -1, stdout: '', stderr: `killed after ${timeout / 1000}s`, timedOut: true }
    }
    const output = await process.output()
    const stdout = decode(output.stdout)
    const stderr = decode(output.stderr)
    const exitCode = await process.exitCode
    // The transcript carries what the command said and the machine keeps the
    // rest: a watcher sees this the moment it lands, and so does the record.
    if (stdout) this.stream.emit('output', { stream: 'stdout', text: clipText(stdout) })
    if (stderr) this.stream.emit('output', { stream: 'stderr', text: clipText(stderr) })
    this.stream.emit('exit', { exitCode, timedOut: false })
    this.stream.flush()
    return { exitCode, stdout, stderr, timedOut: false }
  }

  /**
   * One step of a demonstration.
   *
   * What was clicked and which named keys were pressed, against the title of
   * whatever was on screen — never the text that was typed. A takeover exists
   * so a human can enter a password the model must never see, so the trace it
   * leaves behind cannot be allowed to carry one: `type` is recorded as the
   * fact that typing happened and its length, and nothing else.
   */
  private async recordStep(
    held: { steps: TraceStep[]; typed: string[] },
    event: unknown,
  ): Promise<void> {
    if (held.steps.length >= MAX_TRACE_STEPS) return
    const input = event as { kind?: string; x?: number; y?: number; key?: string; text?: string }
    if (typeof input?.kind !== 'string') return

    // Remembered only to scrub it back out of window titles, and dropped when
    // control is given back.
    if (input.kind === 'type' && typeof input.text === 'string' && input.text.length >= MIN_REDACTED_CHARS) {
      held.typed.push(input.text)
    }

    const step: TraceStep = {
      at: new Date().toISOString(),
      kind: input.kind,
      where: scrub(await this.screenTitle(), held.typed),
    }
    if (input.kind === 'click' || input.kind === 'move') {
      step.x = Math.round(Number(input.x) || 0)
      step.y = Math.round(Number(input.y) || 0)
    }
    if (input.kind === 'key') step.key = input.key
    if (input.kind === 'type') step.typedChars = typeof input.text === 'string' ? input.text.length : 0
    held.steps.push(step)
  }

  /** The active window's title — what the step was about, in words. */
  private async screenTitle(): Promise<string> {
    const container = this.ctx.container
    if (!container?.running) return ''
    try {
      const response = await container.getTcpPort(SCREEN_PORT).fetch('http://screen/context')
      if (!response.ok) return ''
      const body = (await response.json()) as { title?: string }
      return typeof body.title === 'string' ? body.title.slice(0, 200) : ''
    } catch {
      return ''
    }
  }

  /** What the demonstration changed in the workspace. Paths only, never contents. */
  private async touchedSinceMarker(): Promise<string[]> {
    const container = this.ctx.container
    if (!container?.running) return []
    try {
      const process = await container.exec(
        asAgent([
          'sh',
          '-c',
          `find ${WORKSPACE} -newer /tmp/takeover.marker -type f -not -path '*/.browser/*' | head -40`,
        ]),
      )
      if ((await process.exitCode) !== 0) return []
      const output = await process.output()
      return decode(output.stdout).split('\n').map((line) => line.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  /**
   * The machine's screen, one JPEG at a time.
   *
   * The container has no inbound route, so this is reached through the
   * runtime's own port rather than over the network. A machine with no display
   * yet — booting, or one whose browser has not started — answers null rather
   * than an error: an empty window is a state, not a fault.
   */
  private async frame(): Promise<ArrayBuffer | null> {
    const container = this.ctx.container
    if (!container?.running) return null
    try {
      const response = await container.getTcpPort(SCREEN_PORT).fetch('http://screen/frame')
      if (!response.ok) return null
      return await response.arrayBuffer()
    } catch {
      return null
    }
  }

  /**
   * Replay one input event onto the display. Only while a human has taken
   * control: an agent drives the browser through its own commands, and a socket
   * that could type without a takeover would be a way around that.
   */
  private async sendInput(event: unknown): Promise<boolean> {
    const container = this.ctx.container
    if (!container?.running || !this.takeover) return false
    try {
      const response = await container.getTcpPort(SCREEN_PORT).fetch('http://screen/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Push frames while anyone is watching, and stop the moment nobody is. The
   * loop lives with the socket rather than on a timer: an unwatched machine
   * costs nothing to look at, which is what makes the window affordable.
   */
  private startFrames(): void {
    if (this.streaming) return
    this.streaming = true
    const pump = async (): Promise<void> => {
      while (this.stream.watching > 0) {
        const jpeg = await this.frame()
        if (jpeg) this.stream.frame(jpeg)
        await new Promise((resolve) => setTimeout(resolve, FRAME_INTERVAL_MS))
      }
      this.streaming = false
    }
    this.ctx.waitUntil(pump())
  }

  /**
   * Open a page in the machine's own browser.
   *
   * Chromium runs headful on the machine's display with its profile inside the
   * workspace, so a session a human logged in during a takeover is still there
   * on the next wake. It is started detached and left running: the browser is
   * part of the machine, not part of one command.
   */
  async browse(url: string): Promise<{ started: boolean; alreadyRunning: boolean }> {
    const container = this.ctx.container
    if (!container) throw new Error('this Durable Object has no container binding')
    if (!container.running) await this.boot((await this.spec())!, container)

    // One browser per machine. A second Chromium on the same profile fights the
    // first over its lock and neither wins. The window on the display is the
    // check, because it is the thing that would collide — and xdotool is already
    // here for the takeover, where a process lister is not.
    const spec = await this.spec()
    if (!spec) throw new Error('this machine has no lease')
    const env = machineEnv(spec)
    const running = await container.exec(asAgent(['xdotool', 'search', '--class', 'chromium']), { env })
    if ((await running.exitCode) === 0) {
      this.stream.emit('exec', { cmd: ['browse', url], note: 'browser already running' })
      this.stream.flush()
      return { started: false, alreadyRunning: true }
    }

    await container.exec(
      asAgent(['sh', '-c', `nohup node /usr/local/lib/browse.mjs ${JSON.stringify(url)} >/tmp/browse.log 2>&1 &`]),
      { cwd: WORKSPACE, env },
    )
    this.stream.emit('exec', { cmd: ['browse', url] })
    this.stream.flush()
    return { started: true, alreadyRunning: false }
  }

  /** Stop the machine now, keeping the workspace so the next boot restores it. */
  async stop(): Promise<void> {
    await this.snapshotWorkspace()
    await this.ctx.storage.deleteAlarm()
    this.stream.emit('sleep', {})
    this.stream.flush()
    await this.ctx.container?.destroy()
  }

  /**
   * The window's socket.
   *
   * A WebSocket cannot travel back over an RPC method — it is not serializable
   * — so the watch path is the one thing that reaches this object as a request
   * rather than a call. The ticket was checked by the Worker before we get here.
   */
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/watch') return this.watch()
    return new Response('not found', { status: 404 })
  }

  /**
   * Let a watcher onto the stream. It sees everything from the moment it
   * attached; the record is where the earlier part of the run is.
   */
  private watch(): Response {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    // Hibernation would drop the in-memory stream, so the socket is accepted
    // the ordinary way: a watched machine is awake by definition.
    server.accept()
    this.stream.attach(server)
    server.addEventListener('close', () => this.stream.detach(server))
    server.addEventListener('error', () => this.stream.detach(server))
    server.addEventListener('message', (event) => {
      this.ctx.waitUntil(this.onWatcherMessage(event.data))
    })
    server.send(JSON.stringify({ seq: -1, kind: 'watching', at: new Date().toISOString(), payload: {} }))
    this.startFrames()
    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * What a watcher may say. Two things: take the keyboard, and use it.
   *
   * Who is allowed to watch at all was decided by the control plane before the
   * ticket was minted; this only records that a human took control and when, so
   * the timeline can say who held the keyboard for which span.
   */
  private async onWatcherMessage(raw: string | ArrayBuffer): Promise<void> {
    let message: { kind?: string; by?: string; event?: unknown }
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return
    }

    if (message.kind === 'takeover') {
      this.takeover = {
        by: typeof message.by === 'string' ? message.by : 'a person',
        since: Date.now(),
        steps: [],
        typed: [],
      }
      // A marker to diff the workspace against when control is given back.
      await this.exec({ cmd: ['sh', '-c', 'touch /tmp/takeover.marker'] }).catch(() => null)
      this.stream.emit('takeover', { by: this.takeover.by })
      this.stream.flush()
      return
    }

    if (message.kind === 'release') {
      if (this.takeover) {
        const { by, since, steps } = this.takeover
        // The trace is emitted here rather than step by step: it is one
        // demonstration, and a skill is drafted from the whole of it.
        // Scrubbed once more on the way out: a title captured before the last
        // keystroke of a password can still contain the earlier part of it.
        const typed = this.takeover.typed
        this.stream.emit('release', {
          by,
          heldMs: Date.now() - since,
          steps: steps.slice(0, MAX_TRACE_STEPS).map((step) => ({ ...step, where: scrub(step.where, typed) })),
          touched: await this.touchedSinceMarker(),
        })
        this.stream.flush()
      }
      this.takeover = null
      return
    }

    if (message.kind === 'input') {
      const held = this.takeover
      const sent = await this.sendInput(message.event)
      if (sent && held) await this.recordStep(held, message.event)
    }
  }

  /**
   * The record. Batches go to the control plane, which owns every row; failing
   * to report must never fail the work that produced it.
   */
  private async reportEvents(events: readonly VmEvent[]): Promise<void> {
    if (events.length === 0 || !this.env.CONTROL_PLANE_URL) return
    const spec = await this.spec()
    if (!spec) return
    try {
      await fetch(`${this.env.CONTROL_PLANE_URL}/api/internal/vm/events`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.env.EDGE_SERVICE_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ spaceId: spec.spaceId, agentName: spec.agentName, events }),
      })
    } catch (err) {
      console.error('event report failed', err)
    }
  }

  async status(): Promise<{ leased: boolean; running: boolean; watching: number; takeover: boolean }> {
    return {
      leased: (await this.spec()) !== null,
      running: this.ctx.container?.running ?? false,
      watching: this.stream.watching,
      takeover: this.takeover !== null,
    }
  }
}
