import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import { compileForSpace } from '@/lib/vm/policy';
import { PolicyError } from '@visvine/vm-policy';

/**
 * What this space's agent machines may reach (admin only).
 *
 * The list is not authored here — it is compiled from the hosts the space's
 * enabled connectors already declare, so there is one answer to "what may this
 * space talk to" rather than two that drift. This route is the read: an admin
 * can see the compiled policy, its digest, and any connector note whose
 * perimeter could not be parsed and whose hosts are therefore NOT granted.
 *
 * Nothing here mutates anything, and the policy it returns is the same object
 * the edge is handed when a machine boots.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;
  const session = await requireAdmin(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { policy, digest, unreadable, rejected } = await compileForSpace(spaceId);
    return NextResponse.json({
      digest,
      allow: policy.allow,
      deny: policy.deny,
      approval: policy.approval,
      // Binding names only — an injection rule never carries a value.
      inject: policy.inject.map((rule) => ({ host: rule.host, header: rule.header, secret: rule.secret })),
      unreadable,
      rejected,
    });
  } catch (e) {
    // A pattern the grammar cannot enforce is a configuration error an admin
    // fixes, not a policy we quietly widen around.
    if (e instanceof PolicyError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
