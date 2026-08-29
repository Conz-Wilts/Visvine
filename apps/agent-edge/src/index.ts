/**
 * The edge half of the agent runtime.
 *
 * The control plane (Cloud Run) decides everything: who an agent is, what it
 * may reach, whether a run may start. This Worker decides nothing. It boots
 * what it is told to boot, enforces the policy it is handed, and relays the
 * window. That split is what keeps a version skew between two deployment
 * targets from ever becoming a security question — an old edge can be wrong
 * about how fast something happens, never about whether it is allowed.
 *
 * Every request is from the control plane and carries the shared service
 * token. There is no public entry point and no workers.dev URL.
 */
import { machineName, machineRef, type VmPolicy } from '@visvine/vm-policy'
import { AgentMachine, type ExecRequest, type LeaseSpec } from './machine'
import { EgressProxy } from './egress'
import { verifyTicket } from './ticket'

export { AgentMachine, EgressProxy }

export interface Env {
  MACHINE: DurableObjectNamespace<AgentMachine>
  WORKSPACES: R2Bucket
  /** Shared with the control plane; `wrangler secret put EDGE_SERVICE_TOKEN`. */
  EDGE_SERVICE_TOKEN: string
  /** Where egress records are posted. The control plane owns the log, as it owns every row. */
  CONTROL_PLANE_URL?: string
  /** Credentials a policy may inject, by binding name. Read only by the egress entrypoint. */
  [binding: string]: unknown
}

/** Compare without leaking the answer in the timing. */
function tokenMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
}

/**
 * The Durable Object one machine is.
 *
 * `environment` is part of the name and comes from the control plane, never
 * from here: a developer's machine and production's share this Worker, and
 * without it a local test would address a production machine of the same name.
 */
function machineFor(env: Env, environment: string, spaceId: string, agentName: string) {
  return env.MACHINE.get(env.MACHINE.idFromName(machineName(environment, spaceId, agentName)))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // The one unauthenticated route, and it touches nothing: a liveness probe
    // that needs a dependency is a probe that turns an outage into a restart loop.
    if (url.pathname === '/health') return Response.json({ ok: true })

    // The window. A browser cannot be given the service token — it would be a
    // key to every machine, readable in devtools — so it carries a ticket the
    // control plane minted for exactly one machine, for sixty seconds.
    if (url.pathname === '/watch') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('expected a websocket', { status: 426 })
      }
      const environment = url.searchParams.get('env') ?? ''
      const space = url.searchParams.get('space') ?? ''
      const agent = url.searchParams.get('agent') ?? ''
      const ticket = url.searchParams.get('ticket') ?? ''
      if (!environment || !space || !agent || !ticket) {
        return new Response('env, space, agent and ticket are required', { status: 400 })
      }
      const refused = await verifyTicket(ticket, machineRef(environment, space, agent), env.EDGE_SERVICE_TOKEN)
      if (refused) return new Response(refused, { status: 401 })
      // Forwarded as a request, not an RPC call: see AgentMachine#fetch.
      return machineFor(env, environment, space, agent).fetch(request)
    }

    const token = bearer(request)
    if (!env.EDGE_SERVICE_TOKEN || !token || !tokenMatches(token, env.EDGE_SERVICE_TOKEN)) {
      return new Response('unauthorized', { status: 401 })
    }

    let body: { environment?: string; spaceId?: string; agentName?: string } & Record<string, unknown> = {}
    if (request.method === 'POST') {
      body = (await request.json().catch(() => ({}))) as typeof body
    }
    const environment = body.environment ?? url.searchParams.get('env') ?? ''
    const spaceId = body.spaceId ?? url.searchParams.get('space') ?? ''
    const agentName = body.agentName ?? url.searchParams.get('agent') ?? ''
    if (!environment || !spaceId || !agentName) {
      return new Response('environment, spaceId and agentName are required', { status: 400 })
    }

    const machine = machineFor(env, environment, spaceId, agentName)

    try {
      switch (url.pathname) {
        case '/lease':
          return Response.json(await machine.lease(body as unknown as LeaseSpec))
        case '/policy':
          await machine.setPolicy(body.policy as VmPolicy)
          return Response.json({ ok: true })
        case '/exec':
          return Response.json(await machine.exec(body as unknown as ExecRequest))
        case '/browse':
          return Response.json(await machine.browse(String(body.url ?? 'about:blank')))
        case '/stop':
          await machine.stop()
          return Response.json({ ok: true })
        case '/status':
          return Response.json(await machine.status())
        default:
          return new Response('not found', { status: 404 })
      }
    } catch (err) {
      // The control plane distinguishes "the machine refused" from "the edge
      // broke"; both are failures of the run, never of the request that asked.
      console.error('edge request failed', url.pathname, err)
      return Response.json({ error: err instanceof Error ? err.message : 'edge failed' }, { status: 502 })
    }
  },
} satisfies ExportedHandler<Env>
