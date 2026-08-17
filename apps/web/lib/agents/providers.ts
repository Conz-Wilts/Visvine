/**
 * Resolving an agent's model to a live ChatConfig: the registry entry (or the
 * Space's admin-only custom endpoint) plus the Space's decrypted
 * MODEL_KEY_<PROVIDER>. The pure registry lives in ./registry.ts so parsers
 * and tests stay prisma-free; this file is the I/O half.
 */
import prisma from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto/secrets'
import { assertPubliclyRoutable } from '@/lib/net/ssrf'
import { classifyModelStatus, type ChatConfig } from '@/lib/notes/ai'
import { parseModelRef, type ModelRef, type ProviderEntry } from './registry'

export * from './registry'

/** Shape of `Space.agentConfig` (admin-only). */
interface SpaceAgentConfig {
  customEndpoint?: { baseURL: string } | null
}

function parseSpaceAgentConfig(raw: unknown): SpaceAgentConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const ce = obj.customEndpoint
  const baseURL =
    ce && typeof ce === 'object' && typeof (ce as Record<string, unknown>).baseURL === 'string'
      ? ((ce as Record<string, unknown>).baseURL as string)
      : null
  return { customEndpoint: baseURL ? { baseURL } : null }
}

/**
 * Validate an admin-supplied custom endpoint: https, no query/fragment,
 * publicly routable. Throws with a human message.
 */
export async function validateCustomEndpoint(raw: string): Promise<string> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Custom endpoint must be an absolute URL')
  }
  const devHttp = url.protocol === 'http:' && process.env.NODE_ENV === 'development'
  if (url.protocol !== 'https:' && !devHttp) throw new Error('Custom endpoint must use https')
  if (url.search || url.hash) throw new Error('Custom endpoint must not carry a query or fragment')
  await assertPubliclyRoutable(url.hostname, { allowPrivate: devHttp })
  return url.toString().endsWith('/') ? url.toString() : `${url.toString()}/`
}

export type ResolveModelResult =
  | { ok: true; config: ChatConfig; ref: ModelRef }
  | { ok: false; reason: 'no_key' | 'no_endpoint' | 'bad_key' | 'invalid_model'; message: string }

/**
 * Resolve the ChatConfig an agent run uses: registry base URL (or the Space's
 * custom endpoint) + the Space's decrypted MODEL_KEY_<PROVIDER>. The key never
 * leaves this process; callers get a config, not a value to show anyone.
 */
export async function resolveAgentChatConfig(spaceId: string, modelRaw: unknown): Promise<ResolveModelResult> {
  const parsed = parseModelRef(modelRaw)
  if (!parsed.ok) return { ok: false, reason: 'invalid_model', message: parsed.error }
  const { ref } = parsed

  let baseURL = ref.provider.baseURL
  if (!baseURL) {
    const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { agentConfig: true } })
    baseURL = parseSpaceAgentConfig(space?.agentConfig).customEndpoint?.baseURL ?? null
    if (!baseURL) {
      return { ok: false, reason: 'no_endpoint', message: 'No custom model endpoint is set for this space (admin setting).' }
    }
  }

  const row = await prisma.connectorSecret.findUnique({
    where: { secret_identity: { spaceId, name: ref.provider.keySecret } },
    select: { ciphertext: true },
  })
  if (!row) {
    return {
      ok: false,
      reason: 'no_key',
      message: `No model key stored for ${ref.provider.label} — an admin must add ${ref.provider.keySecret}.`,
    }
  }
  let apiKey: string
  try {
    apiKey = decryptSecret(row.ciphertext)
  } catch {
    return { ok: false, reason: 'bad_key', message: 'The stored model key could not be decrypted (SECRETS_KEY).' }
  }
  return { ok: true, ref, config: { apiKey, baseURL, model: ref.modelId } }
}

export type KeyProbeResult = { ok: true } | { ok: false; kind: 'auth' | 'upstream'; message: string }

/**
 * A cheap GET that proves the key is accepted (used at activation / run-now).
 * 401/403 = the key is wrong. Anything else is reported but not fatal — a
 * provider without a models endpoint shouldn't block activation.
 */
export async function probeModelKey(config: ChatConfig, provider: ProviderEntry): Promise<KeyProbeResult> {
  if (!provider.probePath) return { ok: true }
  const base = config.baseURL.endsWith('/') ? config.baseURL : `${config.baseURL}/`
  try {
    const res = await fetch(`${base}${provider.probePath}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    })
    if (res.ok) return { ok: true }
    const body = await res.text().catch(() => '')
    if (classifyModelStatus(res.status, body) === 'auth') {
      return { ok: false, kind: 'auth', message: `${provider.label} rejected the stored key (${res.status}).` }
    }
    return { ok: false, kind: 'upstream', message: `${provider.label} answered ${res.status} to the key check.` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error'
    return { ok: false, kind: 'upstream', message: `Could not reach ${provider.label}: ${msg.split(config.apiKey).join('[redacted]')}` }
  }
}
