import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireApiSession } from '@/lib/api/route';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function groupByWeek(
  dates: Date[],
  chartStart: Date,
  baseline: number
): { label: string; count: number; cumulative: number }[] {
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const weekStart = new Date(chartStart);
    weekStart.setDate(weekStart.getDate() + i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const count = dates.filter(d => d >= weekStart && d < weekEnd).length;
    return {
      label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count,
      cumulative: 0,
    };
  });

  let cum = baseline;
  for (const week of weeks) {
    cum += week.count;
    week.cumulative = cum;
  }

  return weeks;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const { communityId } = await params;
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') ?? '30');

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - days);

    const chartStart = new Date();
    chartStart.setDate(chartStart.getDate() - 84); // 12 weeks

    const [
      totalMembers,
      newMembers,
      totalNodes,
      newNodes,
      totalLinks,
      newLinks,
      nodeTypes,
      memberBaseline,
      memberJoins,
      nodeBaseline,
      nodeCreates,
    ] = await Promise.all([
      prisma.userCommunity.count({ where: { communityId } }),
      prisma.userCommunity.count({ where: { communityId, joinedAt: { gte: periodStart } } }),
      // Total nodes in community
      prisma.node.count({ where: { communityId } }),
      prisma.node.count({ where: { communityId, createdAt: { gte: periodStart } } }),
      prisma.link.count({ where: { communityId } }),
      prisma.link.count({ where: { communityId, createdAt: { gte: periodStart } } }),
      // Node types grouped by type field
      prisma.node.groupBy({
        by: ['type'],
        where: { communityId },
        _count: { id: true },
      }),
      prisma.userCommunity.count({ where: { communityId, joinedAt: { lt: chartStart } } }),
      prisma.userCommunity.findMany({
        where: { communityId, joinedAt: { gte: chartStart } },
        select: { joinedAt: true },
      }),
      prisma.node.count({ where: { communityId, createdAt: { lt: chartStart } } }),
      prisma.node.findMany({
        where: { communityId, createdAt: { gte: chartStart } },
        select: { createdAt: true },
      }),
    ]);

    const memberGrowth = groupByWeek(
      memberJoins.map(m => m.joinedAt),
      chartStart,
      memberBaseline
    );
    const nodeGrowth = groupByWeek(
      nodeCreates.map(n => n.createdAt),
      chartStart,
      nodeBaseline
    );

    return NextResponse.json({
      stats: { totalMembers, newMembers, totalNodes, newNodes, totalLinks, newLinks },
      nodeTypes: nodeTypes.map((nt) => ({ type: nt.type, count: nt._count.id })),
      memberGrowth,
      nodeGrowth,
      activityGrowth: [], // Activity logging not implemented
      topContributors: [], // Activity logging not implemented
      recentActivity: [], // Activity logging not implemented
    });
  } catch (err) {
    logger.error('api.analytics.failed', { err });
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
