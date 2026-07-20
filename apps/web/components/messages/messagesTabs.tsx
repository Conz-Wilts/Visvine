import type React from 'react';
import { MessageCircle, Hash } from 'lucide-react';

export type MessageTab = 'channels' | 'direct';

export const MESSAGE_TABS: { id: MessageTab; label: string; icon: React.ElementType }[] = [
  { id: 'channels', label: 'Channels', icon: Hash },
  { id: 'direct', label: 'Chats', icon: MessageCircle },
];
