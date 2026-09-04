import { NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { placesApiKey, suggestPlaces } from '@/lib/events/places';

// GET /api/places?q=<text>&session=<token> — venue suggestions for the event
// composer. `available: false` with no key, so the composer can fall back to
// a plain field instead of a dead dropdown.
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  if (!placesApiKey()) return NextResponse.json({ available: false, suggestions: [] });

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') ?? '').slice(0, 200);
  const token = params.get('session') ?? undefined;
  try {
    const suggestions = await suggestPlaces(q, token);
    return NextResponse.json({ available: true, suggestions });
  } catch (error) {
    return handleApiError(error, 'places.suggest.failed');
  }
}
