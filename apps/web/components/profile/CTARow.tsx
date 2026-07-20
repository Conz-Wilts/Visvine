'use client';

import React from 'react';
import { UserPlus, MessageCircle, Check, Clock, Pencil } from 'lucide-react';

type CTAState = 'idle' | 'pending' | 'connected' | 'owner' | 'loading';

interface CTARowProps {
  state: CTAState;
  nodeName: string;
  onConnect?: () => void;
  onMessage?: () => void;
  onEditProfile?: () => void;
}

export default function CTARow({
  state,
  nodeName,
  onConnect,
  onMessage,
  onEditProfile,
}: CTARowProps) {
  if (state === 'loading') {
    return (
      <div className="flex items-center gap-3">
        <div className="h-10 w-28 rounded-xl bg-surface-3 animate-pulse" />
        <div className="h-10 w-28 rounded-xl bg-surface-3 animate-pulse" />
      </div>
    );
  }

  if (state === 'owner') {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={onEditProfile}
          className="flex items-center gap-2 h-10 px-5 rounded-xl border border-border-default text-sm font-medium text-brand-black hover:bg-surface-2 transition-colors duration-150"
          aria-label="Edit your profile"
        >
          <Pencil className="w-4 h-4" />
          Edit Profile
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* Connect / Connected */}
      {state === 'idle' && (
        <button
          onClick={onConnect}
          className="flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-green text-brand-black text-sm font-medium hover:bg-[#6bc963] transition-colors duration-150 hover:scale-[1.01]"
          aria-label={`Connect with ${nodeName}`}
        >
          <UserPlus className="w-4 h-4" />
          Connect
        </button>
      )}

      {state === 'pending' && (
        <button
          disabled
          className="flex items-center gap-2 h-10 px-5 rounded-xl bg-surface-3 text-text-muted text-sm font-medium cursor-not-allowed"
          aria-label="Connection request sent"
        >
          <Clock className="w-4 h-4" />
          Request Sent
        </button>
      )}

      {state === 'connected' && (
        <button
          className="flex items-center gap-2 h-10 px-5 rounded-xl border border-border-default text-sm font-medium text-brand-dark-green hover:bg-surface-2 transition-colors duration-150"
          aria-label="Connected"
        >
          <Check className="w-4 h-4" />
          Connected
        </button>
      )}

      {/* Message */}
      {onMessage && (state === 'idle' || state === 'connected') && (
        <button
          onClick={onMessage}
          className="flex items-center gap-2 h-10 px-5 rounded-xl border border-border-default text-sm font-medium text-brand-black hover:bg-surface-2 transition-colors duration-150"
          aria-label={`Message ${nodeName}`}
        >
          <MessageCircle className="w-4 h-4" />
          Message
        </button>
      )}
    </div>
  );
}
