import type { RealtimeEvent } from './types';
import { logger } from '@/lib/logger';

type Subscriber = {
  id: string;
  send: (event: RealtimeEvent) => void;
};

type SubscriberMap = Map<string, Map<string, Subscriber>>;

declare global {
  var messageRealtimeSubscribers: SubscriberMap | undefined;
}

const subscribers: SubscriberMap = globalThis.messageRealtimeSubscribers ?? new Map();

if (!globalThis.messageRealtimeSubscribers) {
  globalThis.messageRealtimeSubscribers = subscribers;
}

export function subscribeToUser(userId: string, send: (event: RealtimeEvent) => void): () => void {
  const subscriptionId = crypto.randomUUID();
  const userSubscribers = subscribers.get(userId) ?? new Map<string, Subscriber>();

  userSubscribers.set(subscriptionId, {
    id: subscriptionId,
    send,
  });

  subscribers.set(userId, userSubscribers);

  return () => {
    const existing = subscribers.get(userId);

    if (!existing) {
      return;
    }

    existing.delete(subscriptionId);

    if (existing.size === 0) {
      subscribers.delete(userId);
    }
  };
}

export function publishToUsers(userIds: string[], event: RealtimeEvent) {
  const uniqueUserIds = [...new Set(userIds)];

  uniqueUserIds.forEach((userId) => {
    const userSubscribers = subscribers.get(userId);

    if (!userSubscribers) {
      return;
    }

    userSubscribers.forEach((subscriber) => {
      try {
        subscriber.send(event);
      } catch (error) {
        logger.error('messages.realtime.send.failed', { err: error });
      }
    });
  });
}
