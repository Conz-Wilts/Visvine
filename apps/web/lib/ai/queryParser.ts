import type { ParsedQuery } from '@/lib/types';
import { getOpenAI } from '@/lib/ai/openai';

const SYSTEM_PROMPT = `You expand and structure search queries for a professional network of people, startups, investors, organizations, events, and groups.

Return strict JSON:
{
  "filters": {
    "type"?: "Person" | "Startup" | "Investor" | "Organization" | "Event" | "Group",
    "location"?: string,
    "name"?: string
  },
  "semantic_terms": string[]
}

Rules:
- Only populate "filters.type" when the user clearly restricts the kind of entity (e.g. "VCs in Sydney" -> type "Investor"; "female founders" -> type "Person").
- Only populate "filters.location" when a specific city/state/country is mentioned.
- Only populate "filters.name" when the user is clearly searching for a named individual or organization.
- NEVER put topics, skills, industries, genders, seniority, or roles into filters. Those go in semantic_terms.
- "semantic_terms" should be an expanded list (6-15 items) capturing the intent, including:
  * the literal terms in the query
  * synonyms and related concepts (e.g. "female" -> "woman women she her")
  * role/industry expansions (e.g. "founder" -> "CEO co-founder entrepreneur builder")
  * domain/industry signals (e.g. "design" -> "UX product visual creative Canva")
- Be generous with expansion — recall matters more than precision; a downstream reranker filters.
- Return only valid JSON, no prose.`;

export async function parseQuery(query: string): Promise<ParsedQuery> {
    if (!query || typeof query !== 'string') {
        throw new Error('Query is required and must be a string');
    }

    const openai = getOpenAI();
    if (!openai) throw new Error('OPENAI_API_KEY is not configured');

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: query },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error('Failed to parse query');

    const parsed: ParsedQuery = JSON.parse(content);
    if (!parsed.filters) parsed.filters = {};
    if (!parsed.semantic_terms || parsed.semantic_terms.length === 0) {
        parsed.semantic_terms = [query];
    }

    return parsed;
}
