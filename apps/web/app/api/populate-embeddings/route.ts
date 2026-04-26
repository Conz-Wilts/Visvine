import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/lib/prisma';
import { getSession, isSuperAdmin } from '@/lib/auth';
import { logger } from '@/lib/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface NodeRow {
  id: string;
  name: string;
  type: string;
  alias: string | null;
  subtitle: string | null;
  location: string | null;
  tags: string[];
  metadata: unknown;
}

function stringifyMetadata(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (v == null || v === '') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(`${k}: ${v}`);
    } else if (Array.isArray(v)) {
      const flat = v.filter(x => x != null).map(String).join(', ');
      if (flat) parts.push(`${k}: ${flat}`);
    } else if (typeof v === 'object') {
      try { parts.push(`${k}: ${JSON.stringify(v)}`); } catch { /* skip */ }
    }
  }
  return parts.length ? parts.join(' | ') : null;
}

function buildEmbeddingInput(n: NodeRow): string {
  const role = n.alias ?? n.type;
  const tagLine = n.tags?.length ? `Tags: ${n.tags.join(', ')}` : null;
  const metaLine = stringifyMetadata(n.metadata);
  const header = `${n.name} — ${role}${n.type && n.type !== role ? ` (${n.type})` : ''}`;
  return [
    header,
    n.subtitle ? `Role: ${n.subtitle}` : null,
    n.location ? `Location: ${n.location}` : null,
    tagLine,
    metaLine,
  ].filter(Boolean).join('\n');
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || !isSuperAdmin(session.email)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const url = new URL(request.url);
    const force = url.searchParams.get('force') === '1';

    const nodes = force
      ? await prisma.$queryRaw<NodeRow[]>`
          SELECT id, name, type, alias, subtitle, location, tags, metadata FROM nodes
        `
      : await prisma.$queryRaw<NodeRow[]>`
          SELECT id, name, type, alias, subtitle, location, tags, metadata FROM nodes WHERE embedding IS NULL
        `;

    if (!nodes || nodes.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All nodes already have embeddings',
        processed: 0,
        total: 0,
      });
    }

    let processed = 0;
    const errors: string[] = [];

    // Batch embed for throughput (OpenAI accepts array input up to ~2048 items)
    const BATCH = 96;
    for (let i = 0; i < nodes.length; i += BATCH) {
      const slice = nodes.slice(i, i + BATCH);
      const inputs = slice.map(buildEmbeddingInput);
      try {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: inputs,
        });
        for (let j = 0; j < slice.length; j++) {
          const node = slice[j];
          const embedding = response.data[j].embedding;
          const embeddingStr = `[${embedding.join(',')}]`;
          try {
            await prisma.$executeRaw`
              UPDATE nodes SET embedding = ${embeddingStr}::vector WHERE id = ${node.id}
            `;
            processed++;
          } catch (error) {
            logger.error('api.populate_embeddings.node.update_failed', { nodeId: node.id, err: error });
            errors.push(`${node.id}: ${String(error)}`);
          }
        }
      } catch (error) {
        logger.error('api.populate_embeddings.batch.failed', { from: i, size: slice.length, err: error });
        errors.push(`batch ${i}: ${String(error)}`);
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      total: nodes.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Embedded ${processed} / ${nodes.length} nodes`,
    });
  } catch (error) {
    logger.error('api.populate_embeddings.failed', { err: error });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const [totalResult, withEmbeddingsResult] = await Promise.all([
      prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM nodes`,
      prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM nodes WHERE embedding IS NOT NULL`,
    ]);

    const total = Number(totalResult[0].count);
    const withEmbeddings = Number(withEmbeddingsResult[0].count);

    return NextResponse.json({
      total,
      withEmbeddings,
      withoutEmbeddings: total - withEmbeddings,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
