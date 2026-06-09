/**
 * Event attendees CSV export API
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEvent, getAttendees, getCommunityGraphData } from '@/lib/eventRepo';
import { requireEventManager } from '@/lib/eventAuth';
import { normalizeStatus } from '@/lib/eventUtils';
import { logger } from '@/lib/logger';

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

/**
 * Escape CSV field (RFC 4180)
 */
function escapeCSV(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/events/[eventId]/export.csv - Export attendees as CSV
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { eventId } = await context.params;
    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get('communityId');

    if (!communityId) {
      return NextResponse.json(
        { error: 'communityId is required' },
        { status: 400 }
      );
    }

    const event = await getEvent(communityId, eventId);

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    // Attendee export is PII — host or community admin only.
    const auth = await requireEventManager(communityId, event);
    if (auth instanceof Response) return auth;

    const attendees = await getAttendees(communityId, eventId);
    const graphData = await getCommunityGraphData(communityId);

    // CSV header
    const headers = [
      'Name',
      'Email',
      'Company',
      'Role',
      'Status',
      'Response',
      'Guests (+N)',
      'LinkedIn URL',
      'Checked In At',
      'Registered At',
      'Answers (JSON)',
    ];

    const rows = attendees.map((attendee) => {
      const person = attendee.personId ? graphData.nodes.find((n) => n.id === attendee.personId) : undefined;
      const name = person?.name || attendee.name || 'Unknown';

      return [
        escapeCSV(name),
        escapeCSV(attendee.email),
        escapeCSV(attendee.companyName),
        escapeCSV(attendee.roleTitle),
        escapeCSV(normalizeStatus(attendee.status)),
        escapeCSV(attendee.response ?? ''),
        escapeCSV(attendee.plusOnes ?? 0),
        escapeCSV(attendee.linkedinUrl),
        escapeCSV(attendee.checkinAt),
        escapeCSV(attendee.createdAt),
        escapeCSV(attendee.answers ? JSON.stringify(attendee.answers) : ''),
      ];
    });

    // Build CSV
    const csvLines = [headers.join(',')];
    for (const row of rows) {
      csvLines.push(row.join(','));
    }

    const csvContent = csvLines.join('\n');

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${event.id}-attendees.csv"`,
      },
    });
  } catch (error) {
    logger.error('api.events.export_csv.failed', { err: error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

