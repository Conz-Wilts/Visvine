import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';
import InviteActions from './InviteActions';

export const dynamic = 'force-dynamic';

/**
 * Space invite landing page (/invite/<token>).
 *
 * This route is NOT public: the proxy bounces a logged-out visitor to
 * /signin?callbackUrl=/invite/<token>, so by the time we render, the user is
 * authenticated and returns here after signing in / creating an account. We then
 * resolve the space by its invite token and show a join screen. Accepting
 * creates a pending membership the space's admins approve in the console.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const session = await getSession();
  if (!session) redirect(`/signin?callbackUrl=/invite/${encodeURIComponent(token)}`);

  const space = await prisma.space.findUnique({
    where: { inviteToken: token },
    select: {
      id: true,
      name: true,
      description: true,
      location: true,
      imageUrl: true,
      _count: { select: { members: { where: { status: 'active' } } } },
      personalOwnerId: true,
    },
  });

  const invalid = !space || space.personalOwnerId !== null;

  const membership = space
    ? await prisma.spaceMember.findUnique({
        where: { userId_spaceId: { userId: session.userId, spaceId: space.id } },
        select: { status: true },
      })
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-md rounded-xl border border-line-subtle bg-surface p-8">
        {invalid ? (
          <div className="text-center">
            <h1 className="text-lg font-semibold text-fg">Invite unavailable</h1>
            <p className="mt-2 text-sm text-fg-muted">
              This invite link is invalid or has been revoked. Ask the space for a fresh link.
            </p>
            <a
              href="/discover"
              className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Discover spaces
            </a>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            {space!.imageUrl ? (
              <img
                src={space!.imageUrl}
                alt={space!.name}
                className="h-16 w-16 rounded-2xl object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-xl font-semibold text-accent-strong">
                {space!.name.trim().charAt(0).toUpperCase()}
              </div>
            )}
            <p className="mt-4 text-xs uppercase tracking-wide text-fg-muted">You&apos;re invited to join</p>
            <h1 className="mt-1 text-xl font-semibold text-fg">{space!.name}</h1>
            {space!.description && (
              <p className="mt-2 text-sm text-fg-muted">{space!.description}</p>
            )}
            <p className="mt-3 text-xs text-fg-muted">
              {space!._count.members} member{space!._count.members === 1 ? '' : 's'}
              {space!.location ? ` · ${space!.location}` : ''}
            </p>

            <InviteActions
              token={token}
              spaceId={space!.id}
              initialStatus={(membership?.status as 'active' | 'pending' | undefined) ?? null}
            />
          </div>
        )}
      </div>
    </div>
  );
}
