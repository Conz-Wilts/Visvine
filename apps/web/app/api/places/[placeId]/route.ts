import { NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { placeLocation, placesApiKey } from '@/lib/events/places';

// GET /api/places/<placeId>?label=<name>&session=<token> — the picked
// suggestion as the location an event stores (address, coordinates, place id
// under the suggestion's own name).
export async function GET(request: Request, { params }: { params: Promise<{ placeId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  if (!placesApiKey()) return NextResponse.json({ error: 'places_unavailable' }, { status: 404 });

  const { placeId } = await params;
  const query = new URL(request.url).searchParams;
  const token = query.get('session') ?? undefined;
  const label = (query.get('label') ?? '').slice(0, 200);
  try {
    return NextResponse.json({ location: await placeLocation(placeId, label, token) });
  } catch (error) {
    return handleApiError(error, 'places.details.failed');
  }
}
