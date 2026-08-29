/**
 * The entrypoint every request from a machine passes through.
 *
 * `interceptAllOutboundHttp` hands this Worker each HTTP request the container
 * makes, so this is the enforcement point §5 describes: outside the sandbox, in
 * our runtime, holding bindings the container cannot read. It is one class
 * shared by every machine — `props` (set when the machine booted) is what tells
 * it whose request it is holding.
 *
 * It decides nothing on its own. The policy comes from the machine's Durable
 * Object, which was handed it by the control plane; this class only applies it.
 */
import { WorkerEntrypoint } from 'cloudflare:workers'
import { machineName } from '@visvine/vm-policy'
import { handleOutbound, type EgressRecord } from './outbound'
import type { Env } from './index'

interface MachineProps {
  environment: string
  spaceId: string
  agentName: string
  machineId: string
}

export class EgressProxy extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const props = this.ctx.props as MachineProps | undefined
    if (!props?.spaceId) {
      // A request with no machine behind it cannot be attributed, so it cannot
      // be judged. Refusing is the only safe reading.
      return new Response('egress denied: this request has no machine\n', { status: 403 })
    }

    const machine = this.env.MACHINE.get(
      this.env.MACHINE.idFromName(machineName(props.environment, props.spaceId, props.agentName)),
    )
    const policy = await machine.policy()

    const records: EgressRecord[] = []
    const response = await handleOutbound(request, {
      policy,
      // Only the bindings a policy may name are readable here, and the
      // container has no access to this object at all.
      secrets: this.env as unknown as Record<string, string | undefined>,
      record: (entry) => records.push(entry),
    })

    this.ctx.waitUntil(report(this.env, props, records))
    return response
  }
}

/**
 * Records go to the control plane, which owns every row. Failing to report must
 * never fail the request that produced it: the record is evidence, and losing
 * one is worth a log line rather than an outage.
 */
async function report(env: Env, props: MachineProps, records: readonly EgressRecord[]): Promise<void> {
  if (records.length === 0 || !env.CONTROL_PLANE_URL) return
  try {
    await fetch(`${env.CONTROL_PLANE_URL}/api/internal/vm/egress`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.EDGE_SERVICE_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ spaceId: props.spaceId, agentName: props.agentName, records }),
    })
  } catch (err) {
    console.error('egress report failed', err)
  }
}
