/**
 * The control plane's client for the edge (apps/agent-edge).
 *
 * Two deployment targets, one boundary, and it is deliberately thin: the edge
 * holds no policy and no schema of its own, so everything here is "do what I
 * decided". Nothing in this file may be given a reason to make a decision —
 * that is what keeps a version skew between Cloud Run and Workers from ever
 * becoming a security question.
 *
 * Configuration: AGENT_EDGE_URL and EDGE_SERVICE_TOKEN, both on Cloud Run, the
 * token matching `wrangler secret put EDGE_SERVICE_TOKEN` on the edge. With
 * either unset there is no edge, and every call fails closed with a reason a
 * human can act on.
 */
import type { VmPolicy } from '@visvine/vm-policy'
import { logger } from '@/lib/logger'

export type InstanceType = 'lite' | 'standard-1' | 'standard-2' | 'standard-3' | 'standard-4'

export interface LeaseSpec {
  spaceId: string
  agentName: string
  policy: VmPolicy
  instanceType: InstanceType
  workspaceKey: string
  idleMinutes: number
}

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export class EdgeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EdgeUnavailableError'
  }
}

function config(): { url: string; token: string } {
  const url = process.env.AGENT_EDGE_URL?.replace(/\/+$/, '')
  const token = process.env.EDGE_SERVICE_TOKEN
  if (!url || !token) {
    throw new EdgeUnavailableError('No agent edge is configured (AGENT_EDGE_URL, EDGE_SERVICE_TOKEN).')
  }
  return { url, token }
}

/** Is there an edge at all? Callers use this to say "no machine" rather than to fail. */
export function edgeConfigured(): boolean {
  return Boolean(process.env.AGENT_EDGE_URL && process.env.EDGE_SERVICE_TOKEN)
}

async function call<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const { url, token } = config()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      // The edge being down is an outage of agents' machines and nothing else,
      // so it is a warn with a reason rather than an error with a stack.
      logger.warn('vm.edge.refused', { path, status: res.status, body: text.slice(0, 500) })
      throw new EdgeUnavailableError(`the agent edge refused ${path} (${res.status})`)
    }
    return JSON.parse(text) as T
  } catch (err) {
    if (err instanceof EdgeUnavailableError) throw err
    throw new EdgeUnavailableError(
      err instanceof Error && err.name === 'AbortError'
        ? `the agent edge did not answer ${path} within ${timeoutMs / 1000}s`
        : `the agent edge is unreachable: ${err instanceof Error ? err.message : 'unknown'}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Take or refresh the lease. Idempotent — a running machine is not restarted. */
export function lease(spec: LeaseSpec): Promise<{ running: boolean; booted: boolean }> {
  return call('/lease', spec, 60_000)
}

export function exec(
  spaceId: string,
  agentName: string,
  cmd: readonly string[],
  timeoutSeconds?: number,
): Promise<ExecResult> {
  // The HTTP timeout sits above the machine's own, so a command that is killed
  // in the container still answers here rather than aborting the request.
  const seconds = timeoutSeconds ?? 120
  return call('/exec', { spaceId, agentName, cmd, timeoutSeconds: seconds }, (seconds + 15) * 1000)
}

/** Open a page in the machine's own browser, and leave it open. */
export function browse(spaceId: string, agentName: string, url: string): Promise<{ started: boolean; alreadyRunning: boolean }> {
  return call('/browse', { spaceId, agentName, url }, 60_000)
}

export function stop(spaceId: string, agentName: string): Promise<{ ok: true }> {
  return call('/stop', { spaceId, agentName })
}
