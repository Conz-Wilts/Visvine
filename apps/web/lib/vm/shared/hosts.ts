/**
 * A connector's `hosts:` as machine policy patterns. Pure.
 *
 * `hosts:` is written for the isolate, which speaks whatever the host answers:
 * an entry may carry a port, name an IP, or say `localhost`. The machine
 * speaks HTTPS to hostnames and nothing else, so the port is dropped and an
 * entry the policy grammar cannot enforce is rejected rather than allowed to
 * fail the compile — one such connector must not leave every agent in the
 * space without a policy. The isolate still reaches it; the machine does not.
 */
import { assertPattern } from '@visvine/vm-policy'

export interface MachineHostPatterns {
  /** Sorted, unique, canonical. */
  patterns: string[]
  /** Entries the machine will not get, verbatim, for the warn and the console. */
  rejected: string[]
}

export function machineHostPatterns(hosts: readonly string[]): MachineHostPatterns {
  const patterns = new Set<string>()
  const rejected: string[] = []
  for (const entry of hosts) {
    const host = entry.split(':')[0]?.trim()
    if (!host) continue
    try {
      patterns.add(assertPattern(host))
    } catch {
      rejected.push(host)
    }
  }
  return { patterns: [...patterns].sort(), rejected }
}
