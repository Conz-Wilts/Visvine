import { notFound } from 'next/navigation';
import { getSession, isSuperAdmin } from '@/lib/session';
import DbVisualization from './DbVisualization';

export const dynamic = 'force-dynamic';

export default async function DbPage() {
  const session = await getSession();
  if (!isSuperAdmin(session?.email)) {
    notFound();
  }

  return <DbVisualization />;
}
