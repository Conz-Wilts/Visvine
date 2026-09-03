/**
 * Resolving an agent's model to a live ChatConfig: where to send the request,
 * which model to name, and the space's decrypted MODEL_KEY_<PROVIDER>.
 *
 * The pure registry lives in ./registry.ts so parsers and tests stay
 * prisma-free, and which models a space HAS lives in ./spaceModels.ts — one
 * read of the `models/` folder that every caller shares. This file is what
 * joins them to a key.
 */
import prisma from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto/secrets'
import { assertPubliclyRoutable } from '@/lib/net/ssrf'
import { classifyModelStatus, type ChatConfig } from '@/lib/notes/ai'
import { parseModelBaseUrl } from '@/lib/models/config'
import { parseModelRef, type ModelPricing, type ModelRef, type ProviderEntry } from './registry'
import { customEndpointOf, declaredPricingFor, defaultModelOf, noModelReason, spaceModels, type SpaceModel } from './spaceModels'
import { fetchedPricing } from './prices'

export * from './registry'

/**
 * Validate an admin-supplied custom endpoint at save time: the pure shape
 * check plus routability. Throws with a human message.
 */
export async function validateCustomEndpoint(raw: string): Promise<string> {
  const parsed = parseModelBaseUrl(raw)
  if (!parsed.ok) throw new Error(parsed.error)
  const url = new URL(parsed.url)
  const devHttp = url.protocol === 'http:' && process.env.NODE_ENV === 'development'
  await assertPubliclyRoutable(url.hostname, { allowPrivate: devHttp })
  return parsed.url
}

/**
 * The price a run of `ref` meters at, for a space. The chain, strongest claim
 * first — declared → shipped → discovered:
 *
 *   1. the model note's `pricing:` (the admin said so);
 *   2. the registry's pinned price (the release said so);
 *   3. `agent_model_prices`, refreshed nightly from public catalogues
 *      (lib/agents/prices.ts — how an arbitrary model id still gets a price);
 *   4. null — the run meters tokens only and MAX_RUN_TOKENS is the ceiling.
 */
async function resolveModelPricing(models: readonly SpaceModel[], ref: ModelRef): Promise<ModelPricing | null> {
  const declared = declaredPricingFor(models, ref.provider.id)
  return declared[ref.modelId] ?? ref.pricing ?? (await fetchedPricing(ref.provider.id, ref.modelId))
}

export type ResolveModelResult =
  | { ok: true; config: ChatConfig; ref: ModelRef; /** The note it came from (its path), when the brief named no model. */ modelNote: string | null }
  | { ok: false; reason: 'no_model' | 'no_key' | 'no_endpoint' | 'bad_key' | 'invalid_model'; message: string }

/**
 * Resolve the ChatConfig an agent run uses.
 *
 * `modelRaw` is the brief's `model:`, and it is OPTIONAL. Absent, the run uses
 * the SPACE's model — the first runnable note under `models/` — because
 * which model a space runs on is a decision it makes once, beside the key that
 * pays for it, not one every brief repeats. A brief that names one pins it,
 * which is what a space running two models is for.
 *
 * With no model at all the answer is `no_model`, and it says to go
 * and add one. It deliberately does NOT name a provider: there is no platform
 * default, and inventing one is how an agent came to be built pointing at
 * Gemini in a space that had never heard of it.
 *
 * The key never leaves this process; callers get a config, not a value to show
 * anyone.
 */
export async function resolveAgentChatConfig(spaceId: string, modelRaw: unknown): Promise<ResolveModelResult> {
  const models = await spaceModels(spaceId)
  const named = typeof modelRaw === 'string' && modelRaw.trim().length > 0

  let ref: ModelRef
  let modelNote: string | null = null
  if (named) {
    const parsed = parseModelRef(modelRaw)
    if (!parsed.ok) return { ok: false, reason: 'invalid_model', message: parsed.error }
    ref = parsed.ref
  } else {
    const fallback = defaultModelOf(models)
    if (!fallback || !fallback.ref) {
      return { ok: false, reason: 'no_model', message: noModelReason(models) ?? 'This space has no model.' }
    }
    const parsed = parseModelRef(fallback.ref)
    if (!parsed.ok) return { ok: false, reason: 'invalid_model', message: parsed.error }
    ref = parsed.ref
    modelNote = fallback.path
  }

  let baseURL = ref.provider.baseURL
  if (!baseURL) {
    const endpoint = customEndpointOf(models)
    if (!endpoint.ok) return { ok: false, reason: 'no_endpoint', message: endpoint.message }
    baseURL = endpoint.baseURL
    // Routability on every resolve, not just at save: a DNS change afterwards
    // must not turn the URL into a path to the instance's own network.
    try {
      const devHttp = baseURL.startsWith('http:') && process.env.NODE_ENV === 'development'
      await assertPubliclyRoutable(new URL(baseURL).hostname, { allowPrivate: devHttp })
    } catch (e) {
      return {
        ok: false,
        reason: 'no_endpoint',
        message: `The custom model endpoint on ${endpoint.name} is not reachable from here: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }
  // Without a resolved price the run is metered in tokens only and the space's
  // dollar cap cannot bind — see MAX_RUN_TOKENS, which is why that is a
  // degraded cap and not an absent one.
  const pricing = await resolveModelPricing(models, ref)

  const row = await prisma.connectorSecret.findUnique({
    where: { secret_identity: { spaceId, name: ref.provider.keySecret } },
    select: { ciphertext: true },
  })
  if (!row) {
    return {
      ok: false,
      reason: 'no_key',
      message: `No key stored for ${ref.provider.label} — add ${ref.provider.keySecret} on its page under Models.`,
    }
  }
  let apiKey: string
  try {
    apiKey = decryptSecret(row.ciphertext)
  } catch {
    return { ok: false, reason: 'bad_key', message: 'The stored model key could not be decrypted (SECRETS_KEY).' }
  }
  return { ok: true, ref: { ...ref, pricing }, modelNote, config: { apiKey, baseURL, model: ref.modelId } }
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
