import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError, parseBody, forbiddenResponse } from '@/lib/api/route';
import { featureAccessForbidden } from '@/lib/auth';
import { requireContext } from '@/lib/notes/api';
import { addLinkResource } from '@/lib/resources/links';

const bodySchema = z.object({
  spaceId: z.string().min(1),
  url: z.string().trim().url().max(2048),
});

/**
 * POST /api/resources/links { spaceId, url } — add a link to the space's
 * Resources, as a resource record wearing the link's unfurl. Answers the record
 * the space already holds for that link rather than making a second.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, bodySchema);
    if (body instanceof NextResponse) return body;
    const context = await requireContext(req, body);
    if (context instanceof Response) return context;
    if (await featureAccessForbidden(context.actor.id, body.spaceId, 'directory', context.actor.email)) return forbiddenResponse();
    const added = await addLinkResource(context, body.url);
    return NextResponse.json({ nodeId: added.node.id, created: added.created }, { status: added.created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error, 'api.resources.links.failed');
  }
}
