import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';
import InviteActions from './InviteActions';

export const dynamic = 'force-dynamic';

/**
 * Community invite landing page (/invite/<token>).
 *
 * This route is NOT public: the proxy bounces a logged-out visitor to
 * /signin?callbackUrl=/invite/<token>, so by the time we render, the user is
 * authenticated and returns here after signing in / creating an account. We then
 * resolve the community by its invite token and show a join screen. Accepting
 * creates a pending membership the community's admins approve in the console.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const session = await getSession();
  if (!session) redirect(`/signin?callbackUrl=/invite/${encodeURIComponent(token)}`);

  const community = await prisma.community.findUnique({
    where: { inviteToken: token },
    select: {
      id: true,
      name: true,
      description: true,
      location: true,
      imageUrl: true,
      memberCount: true,
      personalOwnerId: true,
    },
  });

  const invalid = !community || community.personalOwnerId !== null;

  const membership = community
    ? await prisma.userCommunity.findUnique({
        where: { userId_communityId: { userId: session.userId, communityId: community.id } },
        select: { status: true },
      })
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-md rounded-2xl border border-border-default bg-surface-1 p-8 shadow-lg">
        {invalid ? (
          <div className="text-center">
            <h1 className="text-lg font-semibold text-text-primary">Invite unavailable</h1>
            <p className="mt-2 text-sm text-text-muted">
              This invite link is invalid or has been revoked. Ask the community for a fresh link.
            </p>
            <a
              href="/discover"
              className="mt-6 inline-block rounded-lg bg-brand-green px-4 py-2 text-sm font-medium text-white"
            >
              Explore communities
            </a>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            {community!.imageUrl ? (
              <img
                src={community!.imageUrl}
                alt={community!.name}
                className="h-16 w-16 rounded-2xl object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green/10 text-2xl">
                🌿
              </div>
            )}
            <p className="mt-4 text-xs uppercase tracking-wide text-text-muted">You&apos;re invited to join</p>
            <h1 className="mt-1 text-xl font-semibold text-text-primary">{community!.name}</h1>
            {community!.description && (
              <p className="mt-2 text-sm text-text-muted">{community!.description}</p>
            )}
            <p className="mt-3 text-xs text-text-muted">
              {community!.memberCount} member{community!.memberCount === 1 ? '' : 's'}
              {community!.location ? ` · ${community!.location}` : ''}
            </p>

            <InviteActions
              token={token}
              communityId={community!.id}
              initialStatus={(membership?.status as 'active' | 'pending' | undefined) ?? null}
            />
          </div>
        )}
      </div>
    </div>
  );
}
