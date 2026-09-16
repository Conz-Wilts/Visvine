import { NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { placesApiKey, suggestRegions } from '@/lib/events/places';

// GET /api/places/regions?q=<text>&session=<token> — countries, regions and
// cities for a space's Location. `available: false` with no key, so the field
// falls back to plain text.
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  if (!placesApiKey()) return NextResponse.json({ available: false, suggestions: [] });

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').slice(0, 200);
  const token = params.get('session') ?? undefined;
  try {
    return NextResponse.json({ available: true, suggestions: await suggestRegions(q, token) });
  } catch (error) {
    return handleApiError(error, 'places.regions.failed');
  }
}
