/**
 * Resolving an agent's model to a live ChatConfig: the registry entry (or the
 * `base_url:` of the Space's custom model connector) plus the Space's
 * decrypted MODEL_KEY_<PROVIDER>. The pure registry lives in ./registry.ts so parsers
 * and tests stay prisma-free; this file is the I/O half.
 */
import prisma from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto/secrets'
import { assertPubliclyRoutable } from '@/lib/net/ssrf'
import { classifyModelStatus, type ChatConfig } from '@/lib/notes/ai'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { connectorKind, parseModelBaseUrl, parseModelConnector } from '@/lib/connectors/model'
import { isConnectorEnabled } from '@/lib/connectors/config'
import { parseModelRef, type ModelPricing, type ModelRef, type ProviderEntry } from './registry'
import { fetchedPricing } from './prices'

export * from './registry'

const SHARED_OWNER_KEY = 'shared'

type CustomEndpointResult =
  | { ok: true; baseURL: string; connector: string; pricing: Readonly<Record<string, ModelPricing>> }
  | { ok: false; message: string }

/**
 * The Space's custom model endpoint: the `base_url:` of its `provider: custom`
 * model connector. Read raw from the shared context (no principal — the run
 * may act for an author who can't see `connectors/`, and the folder is
 * admin-written anyway). One endpoint per Space, like one key per provider:
 * two custom connectors with different URLs is a configuration error an admin
 * has to resolve, not a choice the brief gets to make. Routability is checked
 * here, on every resolve, so a DNS change after save can't turn the URL into a
 * path to the instance's own network.
 */
async function findCustomModelEndpoint(spaceId: string): Promise<CustomEndpointResult> {
  const rows = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: 'connectors/', endsWith: '.md' } },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  const found: { name: string; baseURL: string; pricing: Readonly<Record<string, ModelPricing>> }[] = []
  for (const row of rows) {
    const fm = parseFrontmatter(row.content)
    if (fm.type !== 'connector' || connectorKind(fm) !== 'model') continue
    // A connector switched off in the console is not an endpoint: skipping it
    // here is what makes "turn off" mean the same thing for a model connector
    // as loadConnector makes it mean for a runnable one.
    if (!isConnectorEnabled(fm)) continue
    if (typeof fm.provider !== 'string' || fm.provider.trim().toLowerCase() !== 'custom') continue
    const parsed = parseModelConnector(fm)
    if (!parsed.ok) return { ok: false, message: `The custom model connector ${row.path} is invalid: ${parsed.error}` }
    found.push({
      name: row.path.slice('connectors/'.length, -'.md'.length),
      baseURL: parsed.config.baseURL,
      pricing: parsed.config.pricing,
    })
  }
  if (found.length === 0) {
    return { ok: false, message: 'No custom model connector — an admin must add a connector with `provider: custom` and its `base_url:` under /connectors.' }
  }
  const urls = new Set(found.map((f) => f.baseURL))
  if (urls.size > 1) {
    return {
      ok: false,
      message: `More than one custom model endpoint (${found.map((f) => f.name).join(', ')}) — keep one \`provider: custom\` connector, or give them the same base_url.`,
    }
  }
  const [{ name, baseURL, pricing }] = found
  try {
    const devHttp = baseURL.startsWith('http:') && process.env.NODE_ENV === 'development'
    await assertPubliclyRoutable(new URL(baseURL).hostname, { allowPrivate: devHttp })
  } catch (e) {
    return { ok: false, message: `The custom model endpoint on ${name} is not reachable from here: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { ok: true, baseURL, connector: name, pricing }
}

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
 * The `pricing:` maps declared on the Space's enabled model connector notes for
 * one provider, merged (first note wins per model id). Same raw read as
 * {@link findCustomModelEndpoint} and for the same reason: the run may act for
 * someone who can't see `connectors/`, and the folder is admin-written.
 */
async function declaredPricingFor(spaceId: string, providerId: string): Promise<Record<string, ModelPricing>> {
  const rows = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { startsWith: 'connectors/', endsWith: '.md' } },
    select: { content: true },
    orderBy: { path: 'asc' },
  })
  const out: Record<string, ModelPricing> = {}
  for (const row of rows) {
    const fm = parseFrontmatter(row.content)
    if (fm.type !== 'connector' || connectorKind(fm) !== 'model') continue
    if (!isConnectorEnabled(fm)) continue
    if (typeof fm.provider !== 'string' || fm.provider.trim().toLowerCase() !== providerId) continue
    const parsed = parseModelConnector(fm)
    if (!parsed.ok) continue
    for (const [modelId, price] of Object.entries(parsed.config.pricing)) {
      if (!(modelId in out)) out[modelId] = price
    }
  }
  return out
}

/**
 * The price a run of `ref` meters at, for a space. The chain, strongest claim
 * first — declared → shipped → discovered:
 *
 *   1. the connector note's `pricing:` (the admin said so — for a custom
 *      endpoint pass its already-read map as `declared`, for registry
 *      providers the notes are read here);
 *   2. the registry's pinned price (the release said so);
 *   3. `agent_model_prices`, refreshed nightly from public catalogues
 *      (lib/agents/prices.ts — how an arbitrary model id still gets a price);
 *   4. null — the run meters tokens only and MAX_RUN_TOKENS is the ceiling.
 */
async function resolveModelPricing(
  spaceId: string,
  ref: ModelRef,
  declared?: Readonly<Record<string, ModelPricing>>,
): Promise<ModelPricing | null> {
  const notePricing = declared ?? (await declaredPricingFor(spaceId, ref.provider.id))
  return notePricing[ref.modelId] ?? ref.pricing ?? (await fetchedPricing(ref.provider.id, ref.modelId))
}

export type ResolveModelResult =
  | { ok: true; config: ChatConfig; ref: ModelRef }
  | { ok: false; reason: 'no_key' | 'no_endpoint' | 'bad_key' | 'invalid_model'; message: string }

/**
 * Resolve the ChatConfig an agent run uses: registry base URL (or the custom
 * model connector's) + the Space's decrypted MODEL_KEY_<PROVIDER>. The key never
 * leaves this process; callers get a config, not a value to show anyone.
 */
export async function resolveAgentChatConfig(spaceId: string, modelRaw: unknown): Promise<ResolveModelResult> {
  const parsed = parseModelRef(modelRaw)
  if (!parsed.ok) return { ok: false, reason: 'invalid_model', message: parsed.error }
  const { ref } = parsed

  let baseURL = ref.provider.baseURL
  let declared: Readonly<Record<string, ModelPricing>> | undefined
  if (!baseURL) {
    const endpoint = await findCustomModelEndpoint(spaceId)
    if (!endpoint.ok) return { ok: false, reason: 'no_endpoint', message: endpoint.message }
    baseURL = endpoint.baseURL
    declared = endpoint.pricing
  }
  // Without a resolved price the run is metered in tokens only and the space's
  // dollar cap cannot bind — see MAX_RUN_TOKENS, which is why that is a
  // degraded cap and not an absent one.
  const pricing = await resolveModelPricing(spaceId, ref, declared)

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
  return { ok: true, ref: { ...ref, pricing }, config: { apiKey, baseURL, model: ref.modelId } }
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
