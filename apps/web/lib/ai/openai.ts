import OpenAI from 'openai';

// Lazily construct the client so importing this module doesn't throw when
// OPENAI_API_KEY is unset (e.g. during `next build` page-data collection, or
// in the keyword-only fallback path). The OpenAI SDK throws in its constructor
// when no key is available, so we only build it on first call once a key exists.
let client: OpenAI | null = null;

export function getOpenAI(): OpenAI | null {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    if (!client) client = new OpenAI({ apiKey: key });
    return client;
}
