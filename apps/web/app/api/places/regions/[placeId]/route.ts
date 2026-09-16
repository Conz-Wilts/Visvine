import { NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { placesApiKey, regionCountry } from '@/lib/events/places';

// GET /api/places/regions/<placeId>?session=<token> — the ISO country of a
// picked region, which ends the autocomplete session.
export async function GET(request: Request, { params }: { params: Promise<{ placeId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  if (!placesApiKey()) return NextResponse.json({ error: 'places_unavailable' }, { status: 404 });

  const { placeId } = await params;
  const token = new URL(request.url).searchParams.get('session') ?? undefined;
  try {
    return NextResponse.json({ country: await regionCountry(placeId, token) });
  } catch (error) {
    return handleApiError(error, 'places.regions.details.failed');
  }
}
