import MessagesClient from '@/components/messages/MessagesClient';
import type { MessageTab } from '@/components/messages/messagesTabs';
import { getServerMessagingUser } from '@/lib/messages/auth';

export const dynamic = 'force-dynamic';

// Channels moved to their own page (/channels); Messages keeps Chats + Intros.
const TABS: MessageTab[] = ['direct', 'intros'];

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getServerMessagingUser();
  const { tab } = await searchParams;
  // Legacy links: the Groups tab was folded into Chats.
  const normalizedTab = tab === 'private' ? 'direct' : tab;
  const initialTab = TABS.includes(normalizedTab as MessageTab) ? (normalizedTab as MessageTab) : undefined;

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        No user found. Add a user to the database to use messaging.
      </div>
    );
  }

  return (
    <MessagesClient
      currentUser={{
        id: user.id,
        name: user.name,
        image: user.image,
      }}
      initialTab={initialTab}
    />
  );
}
