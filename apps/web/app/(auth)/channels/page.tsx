import MessagesClient from '@/features/messages/components/MessagesClient';
import { getServerMessagingUser } from '@/lib/messages/auth';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage() {
  const user = await getServerMessagingUser();

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        No user found. Add a user to the database to use channels.
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
    />
  );
}
