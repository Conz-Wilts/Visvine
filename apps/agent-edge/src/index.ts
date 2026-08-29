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
import type { VmPolicy } from '@visvine/vm-policy'
import { AgentMachine, type ExecRequest, type LeaseSpec } from './machine'
import { EgressProxy, machineName } from './egress'
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

function machineFor(env: Env, spaceId: string, agentName: string) {
  const name = machineName({ spaceId, agentName })
  return env.MACHINE.get(env.MACHINE.idFromName(name))
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
      const space = url.searchParams.get('space') ?? ''
      const agent = url.searchParams.get('agent') ?? ''
      const ticket = url.searchParams.get('ticket') ?? ''
      if (!space || !agent || !ticket) return new Response('space, agent and ticket are required', { status: 400 })
      const refused = await verifyTicket(ticket, `${space}/${agent}`, env.EDGE_SERVICE_TOKEN)
      if (refused) return new Response(refused, { status: 401 })
      // Forwarded as a request, not an RPC call: see AgentMachine#fetch.
      return machineFor(env, space, agent).fetch(request)
    }

    const token = bearer(request)
    if (!env.EDGE_SERVICE_TOKEN || !token || !tokenMatches(token, env.EDGE_SERVICE_TOKEN)) {
      return new Response('unauthorized', { status: 401 })
    }

    let body: { spaceId?: string; agentName?: string } & Record<string, unknown> = {}
    if (request.method === 'POST') {
      body = (await request.json().catch(() => ({}))) as typeof body
    }
    const spaceId = body.spaceId ?? url.searchParams.get('space') ?? ''
    const agentName = body.agentName ?? url.searchParams.get('agent') ?? ''
    if (!spaceId || !agentName) return new Response('spaceId and agentName are required', { status: 400 })

    const machine = machineFor(env, spaceId, agentName)

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
