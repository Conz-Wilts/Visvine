'use client';

import React, { useState, useRef, useEffect } from 'react';
import { UserPlus, MessageCircle, Check, Clock, Pencil, ChevronDown, Users } from 'lucide-react';

type CTAState = 'idle' | 'pending' | 'connected' | 'owner' | 'loading';

interface CTARowProps {
  state: CTAState;
  nodeName: string;
  onConnect?: () => void;
  onMessage?: () => void;
  onRequestIntro?: () => void;
  onEditProfile?: () => void;
}

export default function CTARow({
  state,
  nodeName,
  onConnect,
  onMessage,
  onRequestIntro,
  onEditProfile,
}: CTARowProps) {
  const [msgOpen, setMsgOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!msgOpen) return;
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMsgOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [msgOpen]);

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

  const showIntro = !!onRequestIntro;

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

      {/* Message — split button when intro is available */}
      {onMessage && (state === 'idle' || state === 'connected') && (
        showIntro ? (
          <div className="relative flex" ref={dropdownRef}>
            {/* Primary: Message */}
            <button
              onClick={onMessage}
              className="flex items-center gap-2 h-10 px-4 rounded-l-xl border border-r-0 border-border-default text-sm font-medium text-brand-black hover:bg-surface-2 transition-colors duration-150"
              aria-label={`Message ${nodeName}`}
            >
              <MessageCircle className="w-4 h-4" />
              Message
            </button>
            {/* Dropdown toggle */}
            <button
              onClick={() => setMsgOpen(x => !x)}
              className="flex items-center justify-center w-8 h-10 rounded-r-xl border border-border-default text-brand-black hover:bg-surface-2 transition-colors duration-150"
              aria-label="More message options"
              aria-haspopup="true"
              aria-expanded={msgOpen}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${msgOpen ? 'rotate-180' : ''}`} />
            </button>
            {/* Dropdown menu */}
            {msgOpen && (
              <div className="absolute top-full right-0 mt-1.5 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg z-50 overflow-hidden">
                <button
                  onClick={() => { setMsgOpen(false); onMessage?.(); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <MessageCircle className="w-4 h-4 text-zinc-400" />
                  Send Message
                </button>
                <div className="h-px bg-zinc-100 dark:bg-zinc-800" />
                <button
                  onClick={() => { setMsgOpen(false); onRequestIntro?.(); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-brand-dark-green hover:bg-brand-light-bg transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Request Intro
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onMessage}
            className="flex items-center gap-2 h-10 px-5 rounded-xl border border-border-default text-sm font-medium text-brand-black hover:bg-surface-2 transition-colors duration-150"
            aria-label={`Message ${nodeName}`}
          >
            <MessageCircle className="w-4 h-4" />
            Message
          </button>
        )
      )}
    </div>
  );
}
