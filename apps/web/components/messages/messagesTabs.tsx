'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Hash, Sparkles } from 'lucide-react';

export type MessageTab = 'channels' | 'direct' | 'intros';

export const MESSAGE_TABS: { id: MessageTab; label: string; icon: React.ElementType }[] = [
  { id: 'channels', label: 'Channels', icon: Hash },
  { id: 'direct', label: 'Chats', icon: MessageCircle },
  { id: 'intros', label: 'Intros', icon: Sparkles },
];

export function formatDateLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' });
}

function measureBtn(btn: HTMLButtonElement, container: HTMLDivElement) {
  const b = btn.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { left: b.left - c.left, width: b.width };
}

/**
 * Centered tab selector for the Messages page.
 * Matches EventsViewSelector styling — grey border, muted inactive text, animated green pill.
 */
export function MessagesTabSelector({ activeTab, onTabChange, counts, tabs = MESSAGE_TABS }: {
  activeTab: MessageTab;
  onTabChange: (tab: MessageTab) => void;
  counts: Record<MessageTab, number>;
  tabs?: { id: MessageTab; label: string; icon: React.ElementType }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number } | null>(null);
  const animatedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    const activeIndex = tabs.findIndex((t) => t.id === activeTab);
    const btn = buttonRefs.current[activeIndex];
    if (!container || !btn) return;
    setPillStyle(measureBtn(btn, container));
    requestAnimationFrame(() => { animatedRef.current = true; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!animatedRef.current) return;
    const container = containerRef.current;
    const activeIndex = tabs.findIndex((t) => t.id === activeTab);
    const btn = buttonRefs.current[activeIndex];
    if (!container || !btn) return;
    setPillStyle(measureBtn(btn, container));
  }, [activeTab, counts, tabs]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-1 rounded-2xl border border-border-default bg-surface-1 p-1 h-12 shadow-float"
    >
      {pillStyle && (
        <span
          className="absolute top-1 bottom-1 rounded-xl bg-brand-green shadow-sm"
          style={{
            left: pillStyle.left,
            width: pillStyle.width,
            transition: 'left 220ms cubic-bezier(0.4,0,0.2,1), width 220ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      )}

      {tabs.map(({ id, label, icon: Icon }, i) => (
        <button
          key={id}
          ref={(el) => { buttonRefs.current[i] = el; }}
          type="button"
          onClick={() => onTabChange(id)}
          className={`relative z-10 flex h-10 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-colors duration-200 ${
            activeTab === id ? 'text-white' : 'text-text-muted hover:text-text-secondary'
          }`}
          aria-label={`${label} tab`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
          {counts[id] > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
              activeTab === id ? 'bg-white/25 text-white' : 'bg-brand-green/15 text-brand-dark-green'
            }`}>
              {counts[id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
