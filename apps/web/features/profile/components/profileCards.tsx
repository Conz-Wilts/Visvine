'use client';

/**
 * Shared presentational primitives for the entity pages — the
 * floating "section" cards, the sticky-rail cards, the stat-strip items and the
 * dashed add-prompt. Used by both the person profile (ProfilePageContent) and the
 * organisation page (OrgPageContent), plus the connector page, so they stay
 * visually of a piece.
 */

import React from 'react';
import { PencilIcon, PlusIcon } from '@/features/shared/icons';
import type { ThemePalette } from '@/lib/profileTheme';

/** Typed helper for inline CSS custom properties (CSSProperties rejects arbitrary keys). */
export const cssVars = (vars: Record<`--${string}`, string>): React.CSSProperties => vars as React.CSSProperties;

export function StatItem({ value, label, onClick, accent }: {
  value: number; label: string; onClick?: () => void; accent?: string;
}) {
  const inner = (
    <>
      <b className="text-[15px] font-bold font-open-sauce text-text-primary tabular-nums">{value}</b>
      <span className="text-[13px] text-text-muted">{label}</span>
    </>
  );
  return onClick ? (
    <button onClick={onClick}
            className="group inline-flex items-baseline gap-1.5 hover:text-[color:var(--accent-dark)] transition-colors"
            style={cssVars({ '--accent-dark': accent ?? 'inherit' })}>
      {inner}
    </button>
  ) : (
    <div className="inline-flex items-baseline gap-1.5">{inner}</div>
  );
}

export function SectionCard({ id, title, badge, isOwner, onEdit, addLabel, scrollMargin, children }: {
  id: string; title: string; badge?: number;
  isOwner?: boolean; onEdit?: () => void; addLabel?: boolean; scrollMargin?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className={`bg-surface-1 border border-border-subtle rounded-2xl shadow-soft ${scrollMargin ?? ''}`}>
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <h2 className="flex items-center gap-2.5 text-[15px] font-bold font-open-sauce text-text-primary">
          {title}
          {badge !== undefined && <span className="text-[13px] font-medium text-text-muted">{badge}</span>}
        </h2>
        {isOwner && onEdit && (
          <button onClick={onEdit}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors">
            {addLabel ? <PlusIcon className="w-3.5 h-3.5" /> : <PencilIcon className="w-3.5 h-3.5" />}{addLabel ? 'Add' : 'Edit'}
          </button>
        )}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

export function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft px-5 py-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted mb-3.5">{title}</div>
      {children}
    </div>
  );
}

export function AddPrompt({ theme, label, onClick }: { theme: ThemePalette; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full py-4 border-[1.5px] border-dashed border-border-default rounded-xl text-sm text-text-muted hover:text-[color:var(--accent-dark)] hover:border-[color:var(--accent)] flex items-center justify-center gap-1.5 transition-colors"
      style={cssVars({ '--accent': theme.base, '--accent-dark': theme.dark })}>
      <PlusIcon className="w-4 h-4" /> {label}
    </button>
  );
}
