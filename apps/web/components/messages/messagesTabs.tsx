import React from 'react';

export type MessageTab = 'direct' | 'private' | 'discussions';

export const MESSAGE_TABS: { id: MessageTab; label: string }[] = [
  { id: 'direct', label: 'Direct' },
  { id: 'private', label: 'Groups' },
  { id: 'discussions', label: 'Community' },
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

export function SidebarTabSelector({ activeTab, onTabChange, counts }: {
  activeTab: MessageTab;
  onTabChange: (tab: MessageTab) => void;
  counts: Record<MessageTab, number>;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-surface-3 p-1">
      {MESSAGE_TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onTabChange(id)}
          className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all duration-200 ${
            activeTab === id
              ? 'bg-surface-1 text-text-primary shadow-sm'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          {label}
          {counts[id] > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
              activeTab === id ? 'bg-brand-green text-white' : 'bg-surface-2 text-text-muted'
            }`}>
              {counts[id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
