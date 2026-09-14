// Server component — can export route segment config.
// MUST stay dynamic: everything below is derived from the caller's session
// cookie, so no per-route caching may be added here (it would leak one user's
// spaces to another).
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

import AuthLayoutClient from './AuthLayoutClient';
import { getSession, isSuperAdmin } from '@/lib/session';
import { listVisibleSpaces, listUserSpaceIds } from '@/lib/spaces/queries';
import { listLockedSubspaces } from '@/lib/spaces/subspaceAccess';
import type { Session } from '@/features/auth/lib/auth-client';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Resolve the session and space data server-side so the client shell
  // hydrates with data instead of waterfalling paint → JS → API round-trips.
  // Shapes match what /api/auth/session, /api/data/spaces and
  // /api/user/spaces return, so provider state is identical either way.
  const session = await getSession();

  if (!session) {
    // Signed out (the proxy normally redirects before this renders). Pass an
    // explicit null session so the client doesn't re-fetch it, but leave the
    // space props undefined — the provider keeps its old client-side path.
    return <AuthLayoutClient initialSession={null}>{children}</AuthLayoutClient>;
  }

  const [spaces, memberships, lockedSubspaces] = await Promise.all([
    listVisibleSpaces(session),
    listUserSpaceIds(session),
    listLockedSubspaces(session.userId),
  ]);

  const initialSession: Session = {
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      image: session.image,
      nodeId: session.nodeId,
      isSuperAdmin: isSuperAdmin(session.email),
    },
  };

  return (
    <AuthLayoutClient
      initialSession={initialSession}
      initialSpaces={spaces}
      initialMemberships={memberships}
      initialLockedSubspaces={lockedSubspaces}
    >
      {children}
    </AuthLayoutClient>
  );
}
