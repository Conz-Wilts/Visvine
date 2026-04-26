import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import DbVisualization from './DbVisualization';

export const dynamic = 'force-dynamic';

export default async function DbPage() {
  const session = await getSession();
  const adminEmail = process.env.DB_ADMIN_EMAIL?.toLowerCase();
  if (!session || !adminEmail || session.email.toLowerCase() !== adminEmail) {
    notFound();
  }

  return <DbVisualization />;
}
