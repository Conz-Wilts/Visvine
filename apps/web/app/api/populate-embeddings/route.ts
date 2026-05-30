import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/lib/prisma';
import { getSession, isSuperAdmin } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { embedNodes } from '@/lib/ai/embeddings';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || !isSuperAdmin(session.email)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const url = new URL(request.url);
    const force = url.searchParams.get('force') === '1';

    // Constructed here (not at module load) so importing this route doesn't throw
    // when OPENAI_API_KEY is unset — e.g. during `next build` page-data collection.
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { processed, total, errors } = await embedNodes(prisma, openai, { force });

    if (total === 0) {
      return NextResponse.json({
        success: true,
        message: 'All nodes already have embeddings',
        processed: 0,
        total: 0,
      });
    }

    for (const err of errors) {
      logger.error('api.populate_embeddings.error', { err });
    }

    return NextResponse.json({
      success: true,
      processed,
      total,
      errors: errors.length > 0 ? errors : undefined,
      message: `Embedded ${processed} / ${total} nodes`,
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
