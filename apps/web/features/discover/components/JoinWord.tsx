'use client';

/** Join is a word in the accent, never a bar. Once in, it goes quiet. */
export default function JoinWord({ joined, onJoin, className = '' }: { joined: boolean; onJoin: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!joined) onJoin(); }}
      disabled={joined}
      className={`shrink-0 text-[13px] font-semibold transition-colors ${
        joined ? 'cursor-default text-text-muted' : 'text-brand-dark-green hover:underline'
      } ${className}`}
    >
      {joined ? 'Joined' : 'Join'}
    </button>
  );
}
