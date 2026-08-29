/**
 * What an agent's machine may reach.
 *
 * Two halves of one decision, and they are in a shared package because they
 * must never disagree. The control plane COMPILES a policy from the space's
 * configuration and the run's narrowing; the edge EVALUATES that policy against
 * every request the sandbox makes. Compilation needs a database and does I/O
 * around this module; evaluation runs per request inside a Worker and does
 * none — everything here is pure, dependency-free, and unit-testable.
 *
 * The rules that shape the grammar, each of them a hole this closes:
 *
 *   • Hostnames only. No CIDR ranges, no IP literals, no ports, no paths. An
 *     address range reachable by literal IP bypasses hostname matching, header
 *     injection and any per-host rule, and can carry data out over DNS lookups
 *     alone.
 *   • HTTPS only. Plain HTTP cannot be attributed to a host with any
 *     confidence, and the machine has no reason to speak it.
 *   • A wildcard replaces a whole label. `*.example.com` matches any depth of
 *     subdomain and never the apex; `api*.example.com` is not a pattern.
 *   • An empty allow list denies. This is the inverse of the substrate's own
 *     default and it is the single most dangerous default in the stack: a bug
 *     that drops the allow list must produce a dead agent, never an open one.
 */

export const POLICY_VERSION = 1 as const

/** A header the edge attaches on the way out. `secret` names a Worker binding, never a value. */
export interface InjectRule {
  host: string
  header: string
  secret: string
}

export interface VmPolicy {
  version: typeof POLICY_VERSION
  /** Host patterns the machine may reach. Empty means it may reach nothing. */
  allow: readonly string[]
  /** Host patterns refused before any allow rule is read. */
  deny: readonly string[]
  /** Host patterns that reach a human before they reach the network. */
  approval: readonly string[]
  /** Credential injections, applied at the edge and invisible to the machine. */
  inject: readonly InjectRule[]
}

export type Decision =
  | { verdict: 'allow'; inject: readonly { header: string; secret: string }[] }
  | { verdict: 'approval'; reason: string }
  | { verdict: 'deny'; reason: string }

export class PolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyError'
  }
}

/**
 * Denied everywhere, for every space, and not overridable by configuration.
 * Private ranges are covered by the IP-literal refusal rather than listed:
 * there is no way to name one that this grammar accepts.
 */
export const PLATFORM_DENY: readonly string[] = [
  'localhost',
  '*.localhost',
  '*.local',
  '*.internal',
  '*.home.arpa',
  'metadata.google.internal',
  'metadata.goog',
]

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** Lower-cased, trailing dot removed. The form every comparison happens in. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, '')
}

/** An address rather than a name — never routable through this policy. */
export function isAddressLiteral(host: string): boolean {
  const h = normalizeHost(host)
  if (h.startsWith('[') || h.includes(':')) return true // IPv6, bracketed or bare
  if (IPV4.test(h)) return true
  // A trailing all-numeric label cannot be a real TLD, so it is a malformed
  // address rather than a hostname.
  const last = h.split('.').pop() ?? ''
  return last.length > 0 && /^\d+$/.test(last)
}

/**
 * Validate a pattern at COMPILE time, so a bad one is a configuration error an
 * admin sees rather than a rule that silently matches nothing at request time.
 */
export function assertPattern(pattern: string, options: { singleLabel?: boolean } = {}): string {
  const p = normalizeHost(pattern)
  if (!p) throw new PolicyError('a host pattern may not be empty')
  if (p.includes('/')) throw new PolicyError(`"${pattern}" looks like a URL or a CIDR range; write a hostname`)
  if (p.includes('@') || p.includes(' ')) throw new PolicyError(`"${pattern}" is not a hostname`)
  if (isAddressLiteral(p)) throw new PolicyError(`"${pattern}" is an address; policy is written in hostnames`)

  const labels = p.split('.')
  for (const label of labels) {
    if (label === '*') continue
    if (label.includes('*')) throw new PolicyError(`"${pattern}" wildcards part of a label; a wildcard replaces a whole label`)
    if (!LABEL.test(label)) throw new PolicyError(`"${pattern}" is not a hostname`)
  }
  // An allow entry must name a domain: a bare label is a search-domain gamble,
  // and what it resolves to depends on the resolver. A deny entry may be one —
  // `localhost` is exactly the kind of name worth refusing by name.
  if (labels.length < 2 && !options.singleLabel) throw new PolicyError(`"${pattern}" has no domain`)
  return p
}

/** Does this hostname match this pattern? Both are normalized here. */
export function hostMatches(pattern: string, host: string): boolean {
  const p = normalizeHost(pattern)
  const h = normalizeHost(host)
  if (!p || !h) return false
  if (!p.includes('*')) return p === h

  const pl = p.split('.')
  const hl = h.split('.')
  // A leading wildcard matches subdomains at any depth, and never the apex.
  if (pl[0] === '*' && pl.length >= 2) {
    const suffix = pl.slice(1)
    if (hl.length <= suffix.length) return false
    return suffix.every((label, i) => label === hl[hl.length - suffix.length + i])
  }
  if (pl.length !== hl.length) return false
  return pl.every((label, i) => label === '*' || label === hl[i])
}

function matchesAny(patterns: readonly string[], host: string): string | null {
  for (const p of patterns) if (hostMatches(p, host)) return p
  return null
}

export interface EvaluatedRequest {
  method: string
  url: string
}

/**
 * The decision, in the order the order matters:
 *
 *   1. an unreadable policy denies — a shape we do not understand is not a
 *      shape we can enforce;
 *   2. anything but HTTPS denies;
 *   3. an address literal denies, before any list is read;
 *   4. the deny list, which no allow rule can reopen;
 *   5. an empty allow list denies;
 *   6. no allow match denies;
 *   7. an approval match holds;
 *   8. otherwise allow, carrying whatever this host's injections are.
 */
export function evaluate(policy: VmPolicy, request: EvaluatedRequest): Decision {
  if (!policy || policy.version !== POLICY_VERSION) {
    return { verdict: 'deny', reason: 'the policy is not one this edge can read' }
  }

  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return { verdict: 'deny', reason: 'the request has no readable URL' }
  }
  if (url.protocol !== 'https:') {
    return { verdict: 'deny', reason: `${url.protocol.replace(':', '')} is not allowed; agents speak https` }
  }

  const host = normalizeHost(url.hostname)
  if (isAddressLiteral(host)) {
    return { verdict: 'deny', reason: 'requests are made to hostnames, not addresses' }
  }

  const denied = matchesAny(policy.deny, host)
  if (denied) return { verdict: 'deny', reason: `${host} is denied (${denied})` }

  if (policy.allow.length === 0) {
    return { verdict: 'deny', reason: 'this policy allows nothing' }
  }
  if (!matchesAny(policy.allow, host)) {
    return { verdict: 'deny', reason: `${host} is not in this agent's allowed hosts` }
  }

  const held = matchesAny(policy.approval, host)
  if (held) return { verdict: 'approval', reason: `${host} needs a human (${held})` }

  const inject = policy.inject
    .filter((rule) => hostMatches(rule.host, host))
    .map((rule) => ({ header: rule.header, secret: rule.secret }))
  return { verdict: 'allow', inject }
}

export interface PolicySources {
  /** The space's own list: connector `hosts:` plus whatever an admin added. */
  spaceAllow: readonly string[]
  /** A run may narrow. Undefined means "the space's list"; empty means nothing. */
  taskAllow?: readonly string[]
  approval?: readonly string[]
  inject?: readonly InjectRule[]
  /** Added to PLATFORM_DENY — the control plane's own hosts, say. */
  deny?: readonly string[]
}

export interface CompiledPolicy {
  policy: VmPolicy
  /** Task entries the space does not permit. Dropped, never honoured, worth a warn. */
  dropped: readonly string[]
}

/**
 * Compile the sources into the policy the edge is handed.
 *
 * The narrowing rule is the load-bearing one: a task may only ask for a subset
 * of what the space already permits, so an entry the space does not cover is
 * dropped rather than granted. That is what makes a run-supplied list safe to
 * accept from anywhere.
 */
export function compile(sources: PolicySources): CompiledPolicy {
  const spaceAllow = unique(sources.spaceAllow.map((p) => assertPattern(p)))
  const deny = unique([...PLATFORM_DENY, ...(sources.deny ?? [])].map((p) => assertPattern(p, { singleLabel: true })))
  const approval = unique((sources.approval ?? []).map((p) => assertPattern(p)))

  let allow = spaceAllow
  const dropped: string[] = []
  if (sources.taskAllow) {
    const asked = unique(sources.taskAllow.map((p) => assertPattern(p)))
    allow = []
    for (const pattern of asked) {
      if (coveredBy(spaceAllow, pattern)) allow.push(pattern)
      else dropped.push(pattern)
    }
  }

  const inject = (sources.inject ?? []).map((rule) => {
    const host = assertPattern(rule.host)
    if (!/^[A-Za-z0-9-]+$/.test(rule.header)) throw new PolicyError(`"${rule.header}" is not a header name`)
    if (!/^[A-Z0-9_]+$/.test(rule.secret)) throw new PolicyError(`"${rule.secret}" is not a binding name`)
    if (!coveredBy(allow, host)) {
      throw new PolicyError(`nothing may be injected into ${host}: it is not a host this policy allows`)
    }
    return { host, header: rule.header, secret: rule.secret }
  })

  return { policy: { version: POLICY_VERSION, allow, deny, approval, inject }, dropped }
}

/**
 * Is `pattern` entirely inside what `permitted` already grants? An exact entry
 * covers itself, and a wildcard covers any host or narrower wildcard beneath
 * it — but a wildcard is never covered by the exact hosts under it, which is
 * what stops a task widening its own reach one label at a time.
 */
function coveredBy(permitted: readonly string[], pattern: string): boolean {
  const p = normalizeHost(pattern)
  for (const entry of permitted) {
    if (normalizeHost(entry) === p) return true
    if (!entry.includes('*')) continue
    if (p.startsWith('*.')) {
      // `*.a.example.com` is covered by `*.example.com`.
      if (hostMatches(entry, p.slice(2))) return true
      continue
    }
    if (hostMatches(entry, p)) return true
  }
  return false
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/**
 * The bytes a policy is identified by. The caller hashes this — the digest
 * rides the lease row so a running machine can be checked against the policy it
 * was booted under, and so a change is visible without diffing lists.
 */
export function canonical(policy: VmPolicy): string {
  return JSON.stringify({
    version: policy.version,
    allow: [...policy.allow].sort(),
    deny: [...policy.deny].sort(),
    approval: [...policy.approval].sort(),
    inject: [...policy.inject]
      .map((r) => `${r.host}|${r.header}|${r.secret}`)
      .sort(),
  })
}
