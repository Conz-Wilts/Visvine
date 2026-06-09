'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSession } from '@/lib/auth-client';
import IntrosInbox from './IntrosInbox';

/**
 * Topbar entry point for the intro system. Replaces the old /intros page: a bell
 * with a pending-action badge that opens the inbox as a popover. Only rendered
 * for signed-in users with a linked person profile.
 */
export default function IntrosBell() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch('/api/intros/count');
      if (!res.ok) return;
      const data = await res.json();
      setCount(data.count ?? 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 60_000);
    return () => clearInterval(t);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // No linked profile → intros aren't available to this account.
  if (!session?.user?.nodeId) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Introductions"
        title="Introductions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative w-12 h-12 rounded-2xl flex items-center justify-center border border-border-subtle bg-surface-1 text-text-secondary hover:text-text-primary hover:bg-surface-2 transition shadow-float"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-brand-green text-brand-black text-[10px] font-bold">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && <IntrosInbox onClose={() => setOpen(false)} onChanged={refreshCount} />}
    </div>
  );
}
