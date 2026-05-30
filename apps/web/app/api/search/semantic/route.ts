import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import type { SemanticSearchResult } from '@/lib/types';
import { parseQuery } from '@/lib/ai/queryParser';
import { logger } from '@/lib/logger';

const hasOpenAI = !!process.env.OPENAI_API_KEY;
const openai = hasOpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

interface Candidate {
    id: string;
    name: string;
    type: string;
    alias: string | null;
    subtitle: string | null;
    location: string | null;
    url: string | null;
    imageUrl: string | null;
    tags: string[];
    metadata: unknown;
    vectorScore: number;
    keywordScore: number;
}

const VECTOR_LIMIT = 60;
const KEYWORD_LIMIT = 40;
const RERANK_INPUT_LIMIT = 40;
const FINAL_LIMIT = 12;

function candidateDigest(c: Candidate): string {
    const metaStr = (() => {
        if (!c.metadata || typeof c.metadata !== 'object') return '';
        const parts: string[] = [];
        for (const [k, v] of Object.entries(c.metadata as Record<string, unknown>)) {
            if (v == null || v === '') continue;
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${v}`);
        }
        return parts.slice(0, 6).join('; ');
    })();
    return [
        `id: ${c.id}`,
        `name: ${c.name}`,
        `type: ${c.type}${c.alias ? ` (${c.alias})` : ''}`,
        c.subtitle ? `role: ${c.subtitle}` : null,
        c.location ? `location: ${c.location}` : null,
        c.tags?.length ? `tags: ${c.tags.join(', ')}` : null,
        metaStr ? `meta: ${metaStr}` : null,
    ].filter(Boolean).join(' | ');
}

interface RerankItem { id: string; score: number; explanation: string }

async function rerank(query: string, candidates: Candidate[]): Promise<Map<string, RerankItem>> {
    if (candidates.length === 0 || !openai) return new Map();

    const listing = candidates
        .slice(0, RERANK_INPUT_LIMIT)
        .map((c, i) => `${i + 1}. ${candidateDigest(c)}`)
        .join('\n');

    const system = `You rerank search candidates for a professional network directory.
Given a user query and numbered candidates, return strict JSON:
{"results": [{"id": string, "score": number /* 0..1 */, "explanation": string /* <= 20 words, concrete */ }]}

Scoring:
- 0.9+ : candidate clearly matches all stated attributes (role, industry, gender, location, etc.)
- 0.6-0.9 : strong partial match
- 0.3-0.6 : tangential / weak signal
- <0.3 : omit from the results array entirely

For gender queries (e.g. "female founders"), infer likely gender from first names and roles from the role/subtitle field. Do not guess wildly — omit ambiguous cases.
Return AT MOST 15 results, sorted by score descending. Use the exact "id" value from each candidate.`;

    const user = `Query: ${query}\n\nCandidates:\n${listing}`;

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' },
        });
        const raw = completion.choices[0].message.content;
        if (!raw) return new Map();
        const parsed = JSON.parse(raw) as { results?: RerankItem[] };
        const map = new Map<string, RerankItem>();
        for (const r of parsed.results ?? []) {
            if (typeof r?.id === 'string' && typeof r?.score === 'number') {
                map.set(r.id, {
                    id: r.id,
                    score: Math.max(0, Math.min(1, r.score)),
                    explanation: (r.explanation || '').slice(0, 280),
                });
            }
        }
        return map;
    } catch (err) {
        logger.error('api.search.semantic.rerank_failed', { err });
        return new Map();
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { query, communityId } = await request.json();
        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'Query is required and must be a string' }, { status: 400 });
        }

        // Without OpenAI we fall back to keyword-only search (per CLAUDE.md).
        // parseQuery and embeddings both require OPENAI_API_KEY.
        const keywordOnlyParse = (): Awaited<ReturnType<typeof parseQuery>> =>
            ({ filters: {}, semantic_terms: [query] });
        const parsed = hasOpenAI
            ? await parseQuery(query).catch(err => {
                logger.error('api.search.semantic.parse_failed', { err });
                return keywordOnlyParse();
            })
            : keywordOnlyParse();

        // Build enriched embedding input — include original query + expanded terms
        let embeddingStr: string | null = null;
        if (openai) {
            try {
                const embedInput = [query, ...(parsed.semantic_terms ?? [])].join(' \n ');
                const embeddingResponse = await openai.embeddings.create({
                    model: 'text-embedding-3-small',
                    input: embedInput,
                });
                embeddingStr = `[${embeddingResponse.data[0].embedding.join(',')}]`;
            } catch (err) {
                logger.error('api.search.semantic.embedding_failed', { err });
                embeddingStr = null;
            }
        }

        const typeFilter = parsed.filters.type ?? null;
        const locationFilter = parsed.filters.location ?? null;
        const nameFilter = parsed.filters.name ?? null;
        const community = communityId ?? null;

        // --- Vector search (primary recall) — only when we have an embedding ---
        const vectorRows = embeddingStr
            ? await prisma.$queryRaw<Array<Omit<Candidate, 'vectorScore' | 'keywordScore'> & { similarity: number }>>`
                SELECT id, name, type, alias, subtitle, location, url, image_url AS "imageUrl", tags, metadata,
                    1 - (embedding <=> ${embeddingStr}::vector) AS similarity
                FROM nodes
                WHERE embedding IS NOT NULL
                    AND (${community}::text IS NULL OR community_id = ${community})
                    AND (${typeFilter}::text IS NULL OR LOWER(type) = LOWER(${typeFilter}))
                    AND (${locationFilter}::text IS NULL OR location ILIKE '%' || ${locationFilter} || '%')
                    AND (${nameFilter}::text IS NULL OR name ILIKE '%' || ${nameFilter} || '%')
                ORDER BY embedding <=> ${embeddingStr}::vector
                LIMIT ${VECTOR_LIMIT}
            `
            : [];

        // --- Keyword search (secondary recall for literal matches) ---
        const keywordTerms = [query, ...(parsed.semantic_terms ?? [])]
            .flatMap(s => s.split(/\s+/))
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length >= 3 && !['the', 'and', 'for', 'who', 'what', 'any', 'all', 'with', 'from', 'that'].includes(s));
        const uniqueKeywords = Array.from(new Set(keywordTerms)).slice(0, 12);
        // Escape LIKE special chars so user text can't become a wildcard
        const likePatterns = uniqueKeywords.map(k => `%${k.replace(/[\\%_]/g, c => '\\' + c)}%`);

        const keywordRows: Array<Omit<Candidate, 'vectorScore' | 'keywordScore'>> = likePatterns.length === 0
            ? []
            : await prisma.$queryRaw<Array<Omit<Candidate, 'vectorScore' | 'keywordScore'>>>`
                SELECT id, name, type, alias, subtitle, location, url, image_url AS "imageUrl", tags, metadata
                FROM nodes
                WHERE (${community}::text IS NULL OR community_id = ${community})
                    AND (${typeFilter}::text IS NULL OR LOWER(type) = LOWER(${typeFilter}))
                    AND (
                        name ILIKE ANY(${likePatterns}::text[])
                        OR COALESCE(subtitle, '') ILIKE ANY(${likePatterns}::text[])
                        OR COALESCE(alias, '') ILIKE ANY(${likePatterns}::text[])
                        OR EXISTS (
                            SELECT 1 FROM unnest(tags) t
                            WHERE t ILIKE ANY(${likePatterns}::text[])
                        )
                    )
                LIMIT ${KEYWORD_LIMIT}
            `;

        // --- Merge candidates ---
        const byId = new Map<string, Candidate>();
        for (const r of vectorRows) {
            byId.set(r.id, { ...r, vectorScore: r.similarity ?? 0, keywordScore: 0 });
        }
        for (const r of keywordRows) {
            const existing = byId.get(r.id);
            if (existing) existing.keywordScore = 1;
            else byId.set(r.id, { ...r, vectorScore: 0, keywordScore: 1 });
        }

        const candidates = Array.from(byId.values())
            .sort((a, b) => (b.vectorScore + b.keywordScore * 0.3) - (a.vectorScore + a.keywordScore * 0.3))
            .slice(0, RERANK_INPUT_LIMIT);

        if (candidates.length === 0) {
            return NextResponse.json({ results: [] });
        }

        // --- LLM rerank ---
        const rerankMap = await rerank(query, candidates);

        // If rerank returned nothing, fall back to vector-only ordering with generic explanations
        const results: SemanticSearchResult[] = (() => {
            if (rerankMap.size > 0) {
                const scored = candidates
                    .map(c => {
                        const r = rerankMap.get(c.id);
                        if (!r) return null;
                        return { c, r };
                    })
                    .filter((x): x is { c: Candidate; r: RerankItem } => x !== null)
                    .sort((a, b) => b.r.score - a.r.score)
                    .slice(0, FINAL_LIMIT);

                return scored.map(({ c, r }) => ({
                    id: c.id, name: c.name, type: c.type,
                    subtitle: c.subtitle ?? undefined,
                    location: c.location ?? undefined,
                    url: c.url ?? undefined,
                    tags: c.tags,
                    metadata: c.metadata as Record<string, unknown>,
                    similarity: r.score,
                    explanation: r.explanation || 'Matches your query.',
                }));
            }
            return candidates.slice(0, FINAL_LIMIT).map(c => ({
                id: c.id, name: c.name, type: c.type,
                subtitle: c.subtitle ?? undefined,
                location: c.location ?? undefined,
                url: c.url ?? undefined,
                tags: c.tags,
                metadata: c.metadata as Record<string, unknown>,
                similarity: c.vectorScore || 0.5,
                explanation: 'Matches your query.',
            }));
        })();

        return NextResponse.json({ results });
    } catch (error) {
        logger.error('api.search.semantic.failed', { err: error });
        return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
}
