import { NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { placeLocation, placesApiKey } from '@/lib/events/places';

// GET /api/places/<placeId>?session=<token> — the picked suggestion as the
// location an event stores (label, address, coordinates, place id).
export async function GET(request: Request, { params }: { params: Promise<{ placeId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  if (!placesApiKey()) return NextResponse.json({ error: 'places_unavailable' }, { status: 404 });

  const { placeId } = await params;
  const token = new URL(request.url).searchParams.get('session') ?? undefined;
  try {
    return NextResponse.json({ location: await placeLocation(placeId, token) });
  } catch (error) {
    return handleApiError(error, 'places.details.failed');
  }
}
