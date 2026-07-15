'use client';

/**
 * ChannelIcon — a channel's emoji icon, falling back to the classic hashtag.
 * EmojiIconPicker — small popover for choosing that emoji (curated grid +
 * free-form input so any emoji works, not just the curated set).
 */

import { useEffect, useRef, useState } from 'react';
import { Hash } from 'lucide-react';

export function ChannelIcon({ icon, className = 'h-4 w-4' }: { icon?: string | null; className?: string }) {
  if (icon) {
    return <span className={`inline-flex shrink-0 items-center justify-center leading-none ${className}`} style={{ fontSize: '0.9em' }}>{icon}</span>;
  }
  return <Hash className={`shrink-0 ${className}`} strokeWidth={2} />;
}

const CURATED_EMOJIS = [
  '💬', '📣', '📌', '🎯', '🚀', '💡', '🔥', '⭐',
  '🎉', '🤝', '🧠', '📚', '📈', '💼', '🛠️', '🎨',
  '🌱', '☕', '🍕', '🎮', '🏆', '❤️', '👋', '🔔',
  '🗳️', '🧭', '🌍', '🎵', '📷', '🏡', '💰', '🤖',
];

export function EmojiIconPicker({
  onSelect,
  onClear,
  onClose,
  clearLabel = 'Use # default',
}: {
  onSelect: (emoji: string) => void;
  /** Omit to hide the reset row (e.g. when creating, where # is already the default). */
  onClear?: () => void;
  onClose: () => void;
  clearLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const submitCustom = () => {
    const trimmed = custom.trim();
    if (!trimmed) return;
    // Keep a single grapheme-ish token — emoji can be several code units.
    onSelect(trimmed.slice(0, 16));
    onClose();
  };

  return (
    <div ref={ref} className="w-56 rounded-2xl border border-border-subtle bg-surface-1 p-2 shadow-float">
      <div className="grid grid-cols-8 gap-0.5">
        {CURATED_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => { onSelect(emoji); onClose(); }}
            className="rounded-lg p-1 text-base leading-none transition-colors hover:bg-surface-2"
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitCustom(); } }}
          placeholder="Any emoji…"
          className="min-w-0 flex-1 rounded-lg border border-border-default bg-surface-1 px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-green/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={submitCustom}
          disabled={!custom.trim()}
          className="rounded-lg bg-brand-green px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          Set
        </button>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={() => { onClear(); onClose(); }}
          className="mt-1.5 flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary"
        >
          <Hash className="h-3.5 w-3.5" strokeWidth={2} />
          {clearLabel}
        </button>
      )}
    </div>
  );
}
