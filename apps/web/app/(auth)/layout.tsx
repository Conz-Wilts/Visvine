// Server component — can export route segment config.
// MUST stay dynamic: everything below is derived from the caller's session
// cookie, so no per-route caching may be added here (it would leak one user's
// spaces to another).
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

import { headers } from 'next/headers';
import AuthLayoutClient from './AuthLayoutClient';
import { themeBootScript } from '@/features/shared/lib/colorThemes';
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
  // Runs before the shell paints, so a chosen accent never flashes green first.
  const themeScript = (
    <script nonce={(await headers()).get('x-nonce') ?? undefined} dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
  );

  if (!session) {
    // Signed out (the proxy normally redirects before this renders). Pass an
    // explicit null session so the client doesn't re-fetch it, but leave the
    // space props undefined — the provider keeps its old client-side path.
    return <>{themeScript}<AuthLayoutClient initialSession={null}>{children}</AuthLayoutClient></>;
  }

  const [spaces, memberships, locked] = await Promise.all([
    listVisibleSpaces(session),
    listUserSpaceIds(session),
    listLockedSubspaces(session.userId),
  ]);
  // A parent's admin who reaches a private sub-space through `parentAdmins`
  // has it in `spaces` already; the locked row would be a door beside an
  // open one.
  const lockedSubspaces = locked.filter((l) => !spaces.some((s) => s.id === l.id));

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
    <>
      {themeScript}
      <AuthLayoutClient
        initialSession={initialSession}
        initialSpaces={spaces}
        initialMemberships={memberships}
        initialLockedSubspaces={lockedSubspaces}
      >
        {children}
      </AuthLayoutClient>
    </>
  );
}
