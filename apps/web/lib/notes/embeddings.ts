// Embeddings access for the retrieval layer — the port of blackbird-brain's
// src/server/embeddings.ts. OpenAI's /embeddings endpoint, configured
// independently of the chat client (./ai.ts, still Gemini); resolved per call so
// a changed key takes effect immediately. Unconfigured → null and the vector
// stage silently drops out of the fused search.
//
// text-embedding-3-small is natively 1536-dim but Matryoshka-trained, so the
// `dimensions` param truncates to 768 with minimal quality loss — which keeps
// the vector(768) columns and their HNSW indexes as-is. Rows embedded by an
// earlier model are ignored automatically: both vector stages filter on
// `model = config.model`, so a switch re-embeds lazily rather than mixing
// incomparable vector spaces.

const EMBED_MODEL = 'text-embedding-3-small'
const EMBED_DIMENSIONS = 768
const BATCH_SIZE = 64
const OPENAI_BASE_URL = 'https://api.openai.com/v1/'

export interface EmbeddingsConfig {
  apiKey: string
  baseURL: string
  model: string
}

/** The resolved embeddings backend, or null when unconfigured. */
export function embeddingsConfig(): EmbeddingsConfig | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return { apiKey, baseURL: OPENAI_BASE_URL, model: process.env.EMBED_MODEL ?? EMBED_MODEL }
}

/**
 * Whether semantic retrieval can run at all. Callers report this alongside
 * results: with no key the vector stages return [] and search silently degrades
 * to keyword + link context, which looks identical to "nothing matched".
 */
export function semanticConfigured(): boolean {
  return embeddingsConfig() !== null
}

/** What the semantic half of a search actually did. */
export type SemanticStatus = 'on' | 'no-key' | 'error'

/** Embed texts (order-preserving), batched to keep request sizes bounded. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const config = embeddingsConfig()
  if (!config) {
    throw new Error('Embeddings are not configured: set OPENAI_API_KEY.')
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
