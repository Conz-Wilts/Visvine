// Embeddings access for the retrieval layer — the port of blackbird-brain's
// src/server/embeddings.ts. Any OpenAI-compatible /embeddings endpoint, backed
// by the same env config as the chat client (./ai.ts); resolved per call so a
// changed key takes effect immediately. Unconfigured → null and the vector
// stage silently drops out of the fused search.

const EMBED_MODEL = 'gemini-embedding-001'
export const EMBED_DIMENSIONS = 768
const BATCH_SIZE = 64
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'

export interface EmbeddingsConfig {
  apiKey: string
  baseURL: string
  model: string
}

/** The resolved embeddings backend, or null when unconfigured. */
export function embeddingsConfig(): EmbeddingsConfig | null {
  const gemmaKey = process.env.GEMMA_API_KEY
  const gemmaBase = process.env.GEMMA_BASE_URL
  if (gemmaKey && gemmaBase) {
    return { apiKey: gemmaKey, baseURL: gemmaBase, model: process.env.EMBED_MODEL ?? EMBED_MODEL }
  }
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    return {
      apiKey: geminiKey,
      baseURL: process.env.GEMMA_BASE_URL ?? GEMINI_BASE_URL,
      model: process.env.EMBED_MODEL ?? EMBED_MODEL,
    }
  }
  return null
}

/** Embed texts (order-preserving), batched to keep request sizes bounded. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const config = embeddingsConfig()
  if (!config) {
    throw new Error('Embeddings are not configured: set GEMINI_API_KEY, or GEMMA_API_KEY + GEMMA_BASE_URL.')
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
