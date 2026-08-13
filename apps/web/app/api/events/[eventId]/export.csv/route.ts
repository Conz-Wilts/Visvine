/**
 * Event attendees CSV export API
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEvent, getAttendees, getSpaceContextData } from '@/lib/eventRepo';
import { requireEventManager } from '@/lib/eventAuth';
import { normalizeStatus } from '@/lib/eventUtils';
import { handleApiError } from '@/lib/api/route';

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
    const spaceId = searchParams.get('spaceId');

    if (!spaceId) {
      return NextResponse.json(
        { error: 'spaceId is required' },
        { status: 400 }
      );
    }

    const event = await getEvent(spaceId, eventId);

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    // Attendee export is PII — host or space admin only.
    const auth = await requireEventManager(spaceId, event);
    if (auth instanceof Response) return auth;

    const attendees = await getAttendees(spaceId, eventId);
    const contextData = await getSpaceContextData(spaceId);

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
      const person = attendee.personId ? contextData.nodes.find((n) => n.id === attendee.personId) : undefined;
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
    return handleApiError(error, 'api.events.export_csv.failed');
  }
}

