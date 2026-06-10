'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Users, ChevronDown, UserPlus, Mail, Loader2 } from 'lucide-react';
import IntroRequestModal, { type IntroTargetNode } from '@/components/intros/IntroRequestModal';

interface ConnectButtonProps {
  targetNode: IntroTargetNode;
  /** Community the intro is scoped to. Empty string disables intro requests. */
  communityId: string;
  /** Display name of the viewer (for modal copy). */
  requesterName: string;
  /** Optional accent to match the profile theme; defaults to brand green. */
  accent?: { base: string; dark: string };
}

/**
 * The profile "Connect ▾" dropdown — the single entry point for reaching out.
 * Opens a popup menu (request an intro / send a message); the intro flow is a
 * modal owned here so any profile surface can drop this in.
 */
export default function ConnectButton({ targetNode, communityId, requesterName, accent }: ConnectButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [openingDm, setOpeningDm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Open (or create) the DM with this person directly, landing in the thread.
  // Falls back to the messages index if their profile isn't linked to a user.
  const openDm = async () => {
    setOpeningDm(true);
    try {
      const res = await fetch('/api/messages/conversations/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: targetNode.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.conversation?.id) {
        router.push(`/messages/${data.conversation.id}`);
        return;
      }
      router.push('/messages');
    } catch {
      router.push('/messages');
    } finally {
      setOpeningDm(false);
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const base = accent?.base ?? 'var(--color-brand-green, #78d870)';
  const canIntro = communityId.length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-white transition hover:opacity-95 active:scale-[0.99]"
        style={{ background: base }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Users className="w-4 h-4" />
        Connect
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-2 w-64 bg-surface-1 border border-border-subtle rounded-xl shadow-lg z-50 overflow-hidden"
        >
          <button
            role="menuitem"
            disabled={!canIntro}
            onClick={() => { setOpen(false); setIntroOpen(true); }}
            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span
              className="mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-none"
              style={{ background: 'var(--color-brand-light-bg, #eaf9ec)', color: accent?.dark ?? 'var(--color-brand-dark-green, #2f7a3e)' }}
            >
              <UserPlus className="w-4 h-4" />
            </span>
            <span className="min-w-0">
              <b className="block text-sm font-semibold text-text-primary">Request an introduction</b>
              <span className="block text-xs text-text-muted">
                {canIntro ? 'Ask someone you both know' : 'Join a community to request intros'}
              </span>
            </span>
          </button>

          <div className="h-px bg-border-subtle" />

          <button
            role="menuitem"
            disabled={openingDm}
            onClick={() => void openDm()}
            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-2 transition disabled:opacity-60"
          >
            <span className="mt-0.5 w-8 h-8 rounded-lg bg-surface-2 text-text-secondary flex items-center justify-center flex-none">
              {openingDm ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            </span>
            <span className="min-w-0">
              <b className="block text-sm font-semibold text-text-primary">Send a message</b>
              <span className="block text-xs text-text-muted">
                Start a direct conversation with {targetNode.name.split(' ')[0]}
              </span>
            </span>
          </button>
        </div>
      )}

      {introOpen && (
        <IntroRequestModal
          communityId={communityId}
          targetNode={targetNode}
          requesterName={requesterName}
          onClose={() => setIntroOpen(false)}
        />
      )}
    </div>
  );
}
