/**
 * The outbound handler: the point where a policy becomes enforcement.
 *
 * Every HTTP request an agent's container makes arrives here, in the Workers
 * runtime, outside the sandbox. Nothing about the request is trusted — not its
 * host, not its headers, not that it was made by our own runtime rather than by
 * something the agent downloaded. The decision comes from `@visvine/vm-policy`,
 * the same module the control plane compiles with, and this file does only what
 * the decision says.
 *
 * Two properties worth stating because they are the reason this runs at the
 * edge rather than inside the machine:
 *
 *   • A credential injected here is read from a Worker binding the sandbox has
 *     no access to, attached only to requests bound for the host it belongs to,
 *     and never written anywhere the machine can read back.
 *   • A refusal is recorded with the host that was asked for. The log is the
 *     detection surface for §12 — a denial is the system working, so it is a
 *     `warn`, and repeated ones are what an anomaly rule watches.
 */
import { evaluate, type Decision, type VmPolicy } from '@visvine/vm-policy'

export interface EgressRecord {
  at: string
  method: string
  host: string
  path: string
  verdict: Decision['verdict']
  reason?: string
  status?: number
  bytes?: number
}

export interface OutboundContext {
  policy: VmPolicy | null
  /** Worker bindings, read for injected credentials only. */
  secrets: Record<string, string | undefined>
  /** Where a record goes. The caller decides whether that is a batch, a fetch, or a test's array. */
  record: (entry: EgressRecord) => void
  /** The upstream call, injectable so tests never touch the network. */
  fetchUpstream?: (request: Request) => Promise<Response>
}

function refusal(reason: string, status: number): Response {
  // The agent sees a plain, quotable refusal. It is not an error page and it is
  // not a redirect: a model that reads this should be able to tell its human
  // exactly which host it was refused and ask for it by name.
  return new Response(`egress denied: ${reason}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export async function handleOutbound(request: Request, ctx: OutboundContext): Promise<Response> {
  const at = new Date().toISOString()
  let host = ''
  let path = ''
  try {
    const url = new URL(request.url)
    host = url.hostname
    path = url.pathname
  } catch {
    // Left empty; evaluate() refuses an unreadable URL below.
  }

  // No policy is not "no restrictions": a machine whose policy has not been
  // handed to it yet may not reach anything.
  if (!ctx.policy) {
    const reason = 'this machine has no policy yet'
    ctx.record({ at, method: request.method, host, path, verdict: 'deny', reason })
    return refusal(reason, 403)
  }

  const decision = evaluate(ctx.policy, { method: request.method, url: request.url })

  if (decision.verdict === 'deny') {
    ctx.record({ at, method: request.method, host, path, verdict: 'deny', reason: decision.reason })
    return refusal(decision.reason, 403)
  }

  if (decision.verdict === 'approval') {
    // The run pauses and a human is asked (§12). Until the approval queue
    // exists the request is refused rather than held — which is the safe
    // direction, and says so plainly.
    ctx.record({ at, method: request.method, host, path, verdict: 'approval', reason: decision.reason })
    return refusal(`${decision.reason}; no approval is on record`, 403)
  }

  const outbound = new Request(request)
  for (const { header, secret } of decision.inject) {
    const value = ctx.secrets[secret]
    if (!value) {
      // A policy that promises a credential the edge does not hold would
      // otherwise send an unauthenticated request and let the agent read a 401
      // as "the service is down". Refuse instead.
      const reason = `${secret} is not configured on this edge`
      ctx.record({ at, method: request.method, host, path, verdict: 'deny', reason })
      return refusal(reason, 503)
    }
    outbound.headers.set(header, value)
  }

  const upstream = ctx.fetchUpstream ?? fetch
  const response = await upstream(outbound)
  const bytes = Number(response.headers.get('content-length') ?? 0) || undefined
  ctx.record({ at, method: request.method, host, path, verdict: 'allow', status: response.status, bytes })
  return response
}
