'use client';

/**
 * Shared presentational primitives for the entity pages — the sections, the
 * sticky-rail groups, the stat-strip items and the add-prompt. Used by the
 * person profile (ProfilePageContent), the organisation page (OrgPageContent),
 * the space pages and the connector page, so they stay visually of a piece.
 *
 * None of them draws a box. A section is a heading on a hairline with its
 * content underneath; siblings stack with the rule between them, the way the
 * settings console already reads.
 */

import React from 'react';
import { PencilIcon, PlusIcon } from '@/features/shared/icons';

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

export function SectionCard({ id, title, badge, icon, accent, action, isOwner, onEdit, addLabel, scrollMargin, children }: {
  id: string; title: string; badge?: number;
  /** A glyph before the title, drawn in `accent` (the entity's dark shade). */
  icon?: React.ReactNode; accent?: string;
  /** A control pinned to the right of the heading; `onEdit` renders the standard one. */
  action?: React.ReactNode;
  isOwner?: boolean; onEdit?: () => void; addLabel?: boolean; scrollMargin?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className={`border-t border-border-subtle pt-5 first:border-t-0 first:pt-0 ${scrollMargin ?? ''}`}>
      <div className="flex items-center justify-between gap-2 pb-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold font-open-sauce text-text-primary">
          {icon && <span style={{ color: accent }}>{icon}</span>}
          {title}
          {badge !== undefined && <span className="text-[13px] font-medium text-text-muted">{badge}</span>}
        </h2>
        {action}
        {isOwner && onEdit && (
          <button onClick={onEdit}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors">
            {addLabel ? <PlusIcon className="w-3.5 h-3.5" /> : <PencilIcon className="w-3.5 h-3.5" />}{addLabel ? 'Add' : 'Edit'}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted mb-3">{title}</div>
      {children}
    </div>
  );
}

