'use client';

import React from 'react';
import { Check } from 'lucide-react';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import type { MutualConnection } from '@/lib/intros/types';

/** A selectable "you both know X" candidate introducer. */
export default function MutualConnectionCard({
  mutual,
  selected,
  onSelect,
}: {
  mutual: MutualConnection;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition ${
        selected
          ? 'border-brand-green bg-brand-light-bg'
          : 'border-border-subtle hover:border-border-default hover:bg-surface-2'
      }`}
    >
      {mutual.imageUrl ? (
        <img src={mutual.imageUrl} alt={mutual.name} className="w-11 h-11 rounded-xl object-cover flex-none" />
      ) : (
        <span className="w-11 h-11 rounded-xl overflow-hidden flex-none">
          <PersonSilhouette />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <b className="block text-sm font-semibold text-text-primary truncate">{mutual.name}</b>
        {mutual.subtitle && <span className="block text-xs text-text-muted truncate">{mutual.subtitle}</span>}
      </span>
      <span
        className={`w-5 h-5 rounded-full border flex items-center justify-center flex-none transition ${
          selected ? 'bg-brand-green border-brand-green' : 'border-border-default'
        }`}
      >
        {selected && <Check className="w-3 h-3 text-brand-black" />}
      </span>
    </button>
  );
}
