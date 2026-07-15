import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';
import OnboardingWizard from './OnboardingWizard';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/signin');

  const person = await prisma.person.findUnique({
    where: { userId: session.userId },
  });

  if (!person) redirect('/home');
  if (person.hasOnboarded) redirect('/home');

  return (
    <OnboardingWizard
      person={JSON.parse(JSON.stringify(person))}
      userName={session.name}
    />
  );
}
