// Embeddings access for the retrieval layer. OpenRouter's /embeddings endpoint
// — the same key and account as the chat client (./ai.ts), so the deployment's
// AI is one bill and one rotation — resolved per call so a changed key takes
// effect immediately. Unconfigured → null and the vector stage silently drops
// out of the fused search.
//
// openai/text-embedding-3-small is natively 1536-dim but Matryoshka-trained, so
// the `dimensions` param truncates to 768 with minimal quality loss — which
// keeps the vector(768) columns and their HNSW indexes as-is. Rows embedded by
// an earlier model are ignored automatically: both vector stages filter on
// `model = config.model`, so a switch re-embeds lazily rather than mixing
// incomparable vector spaces. The model id is the OpenRouter slug, which is why
// vectors written before OpenRouter (bare `text-embedding-3-small`) are stale
// and `pnpm db:embed` is the backfill.

const EMBED_MODEL = 'openai/text-embedding-3-small'
const EMBED_DIMENSIONS = 768
const BATCH_SIZE = 64
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/'

export interface EmbeddingsConfig {
  apiKey: string
  baseURL: string
  model: string
}

/** The resolved embeddings backend, or null when unconfigured. */
export function embeddingsConfig(): EmbeddingsConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return { apiKey, baseURL: OPENROUTER_BASE_URL, model: process.env.EMBED_MODEL ?? EMBED_MODEL }
}

/**
 * Whether semantic retrieval can run at all. Callers report this alongside
 * results: with no key the vector stages return [] and search silently degrades
 * to keyword + link context, which looks identical to "nothing matched".
 */
export function semanticConfigured(): boolean {
  return embeddingsConfig() !== null
}

/**
 * What the semantic half of a search actually did. `off` is the space's own
 * choice (embedding switched off in its Clean section), as opposed to
 * `no-key`, which is the deployment's.
 */
export type SemanticStatus = 'on' | 'no-key' | 'off' | 'error'

/** Embed texts (order-preserving), batched to keep request sizes bounded. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const config = embeddingsConfig()
  if (!config) {
    throw new Error('Embeddings are not configured: set OPENROUTER_API_KEY.')
  }
  const base = config.baseURL.endsWith('/') ? config.baseURL.slice(0, -1) : config.baseURL
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: config.model, input: batch, dimensions: EMBED_DIMENSIONS }),
    })
    if (!res.ok) {
      let apiMessage: string | undefined
      try {
        const errBody = (await res.json()) as { error?: { message?: string } }
        apiMessage = errBody?.error?.message
      } catch {
        /* ignore */
      }
      throw new Error(`Embeddings request failed (${res.status})${apiMessage ? `: ${apiMessage}` : ''}`)
    }
    const json = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] }
    if (!json.data || json.data.length !== batch.length) {
      throw new Error('The embeddings endpoint returned an unexpected shape.')
    }
    const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (const d of sorted) {
      if (!Array.isArray(d.embedding)) throw new Error('The embeddings endpoint returned an unexpected shape.')
      out.push(d.embedding)
    }
  }
  return out
}
