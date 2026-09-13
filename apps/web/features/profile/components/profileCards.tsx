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

import React, { useState } from 'react';
import { PencilIcon, PlusIcon } from '@/features/shared/icons';

/** A website's bare host for display — `https://www.acme.com/x` → `acme.com`. */
export const hostname = (url?: string | null) => {
  if (!url) return '';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
};

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

export function SectionCard({ id, title, badge, icon, accent, action, isOwner, onEdit, onAdd, scrollMargin, children }: {
  id: string; title: string; badge?: number;
  /** A glyph before the title, drawn in `accent` (the entity's dark shade). */
  icon?: React.ReactNode; accent?: string;
  /** A control pinned to the right of the heading; `onEdit` renders the standard one. */
  action?: React.ReactNode;
  isOwner?: boolean; onEdit?: () => void;
  /** Beside `onEdit`, a plus that adds to the section — the pair LinkedIn puts on a list section. */
  onAdd?: () => void;
  scrollMargin?: string; children: React.ReactNode;
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
        {isOwner && (onAdd || onEdit) && (
          <div className="flex items-center gap-1 -mr-2">
            {onAdd && <EditIconButton onClick={onAdd} add label={`Add to ${title.toLowerCase()}`} />}
            {onEdit && <EditIconButton onClick={onEdit} label={`Edit ${title.toLowerCase()}`} />}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * The owner's edit affordance: a bare pencil (or plus, when the section is
 * still empty) in a round hover target, the way LinkedIn marks each section
 * editable. `label` is the accessible name and the hover tooltip.
 */
export function EditIconButton({ onClick, add, label, className }: {
  onClick: () => void; add?: boolean; label: string; className?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
            className={`w-9 h-9 flex-none grid place-items-center rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors ${className ?? ''}`}>
      {add ? <PlusIcon className="w-5 h-5" /> : <PencilIcon className="w-[18px] h-[18px]" />}
    </button>
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


/** Long prose folded at `limit` characters behind a Read more toggle. */
export function AboutText({ text, accent, limit = 280, className }: {
  text: string; accent: string; limit?: number; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > limit;
  const shown = long && !open ? text.slice(0, limit).trimEnd() + '…' : text;
  return (
    <div>
      <p className={`text-[15px] text-text-secondary leading-relaxed whitespace-pre-line ${className ?? ''}`}>{shown}</p>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-2 text-[13px] font-bold hover:underline" style={{ color: accent }}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
