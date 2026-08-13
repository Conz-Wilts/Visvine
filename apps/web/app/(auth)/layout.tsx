// Server component — can export route segment config.
// MUST stay dynamic: everything below is derived from the caller's session
// cookie, so no per-route caching may be added here (it would leak one user's
// spaces to another).
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

import AuthLayoutClient from './AuthLayoutClient';
import { getSession, isSuperAdmin } from '@/lib/session';
import { listVisibleSpaces, listUserSpaces } from '@/lib/spaces/queries';
import type { Session } from '@/features/auth/lib/auth-client';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Resolve the session and space data server-side so the client shell
  // hydrates with data instead of waterfalling paint → JS → API round-trips.
  // Shapes match what /api/auth/session, /api/data/communities and
  // /api/user/communities return, so provider state is identical either way.
  const session = await getSession();

  if (!session) {
    // Signed out (the proxy normally redirects before this renders). Pass an
    // explicit null session so the client doesn't re-fetch it, but leave the
    // space props undefined — the provider keeps its old client-side path.
    return <AuthLayoutClient initialSession={null}>{children}</AuthLayoutClient>;
  }

  const [spaces, memberships] = await Promise.all([
    listVisibleSpaces(session),
    listUserSpaces(session),
  ]);

  const initialSession: Session = {
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      image: session.image,
      nodeId: session.personId,
      isSuperAdmin: isSuperAdmin(session.email),
    },
  };

  return (
    <AuthLayoutClient
      initialSession={initialSession}
      initialSpaces={spaces}
      initialMemberships={memberships.map(m => ({ id: m.id, isAdmin: m.isAdmin }))}
    >
      {children}
    </AuthLayoutClient>
  );
}
