'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Plus, Pencil, ChevronDown, ChevronUp, Palette,
} from 'lucide-react';
import type { WorkExperience } from '@/lib/profileTypes';
import { formatDateRange, PROFICIENCY_LABELS } from '@/lib/profileTypes';
import { PALETTES, type ThemePalette } from '@/lib/profileTheme';

// ─── Helpers ────────────────────────────────────────────────────────────────

export function initials(name: string) {
  const words = name.trim().split(/\s+/);
  return words.length === 1
    ? words[0].substring(0, 2).toUpperCase()
    : (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function memberSinceYear(iso: string | undefined) {
  if (!iso) return null;
  return new Date(iso).getFullYear();
}

// ─── Small primitives ───────────────────────────────────────────────────────

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-1 rounded-2xl border border-border-subtle shadow-soft overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({
  icon, title, isOwner, onAdd, onEdit,
}: {
  icon: React.ReactNode;
  title: string;
  isOwner: boolean;
  onAdd?: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 pt-5 pb-3">
      <div className="flex items-center gap-2">
        <span className="text-text-muted">{icon}</span>
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      </div>
      {isOwner && (
        <div className="flex items-center gap-0.5">
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {onAdd && (
            <button
              onClick={onAdd}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
              title="Add"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function EmptyPrompt({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className="w-full py-6 border-2 border-dashed border-border-default rounded-xl text-sm text-text-muted hover:border-brand-green hover:text-brand-dark-green transition-colors flex items-center justify-center gap-1.5"
    >
      <Plus className="w-4 h-4" /> {label}
    </button>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="w-full py-6 flex items-center justify-center">
      <p className="text-sm text-text-muted italic">{label}</p>
    </div>
  );
}

// ─── Color picker popover ───────────────────────────────────────────────────

export function ThemePicker({
  current,
  systemPalette,
  onSelect,
}: {
  current: ThemePalette;
  systemPalette: ThemePalette;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const isDefault = current.id === 'system';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/20 backdrop-blur-sm text-white text-xs font-medium hover:bg-black/30 transition-colors"
        title="Change theme color"
      >
        <Palette className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{isDefault ? 'Default' : current.name}</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 p-3 bg-surface-1 border border-border-subtle rounded-2xl shadow-lg z-20 w-56">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2.5 px-0.5">
            Theme color
          </p>

          <div className="mb-3 pb-3 border-b border-border-subtle">
            <button
              onClick={() => { onSelect(null); setOpen(false); }}
              className="flex items-center gap-2.5 w-full group"
              title="Reset to default"
            >
              <span
                className="w-8 h-8 rounded-full border-2 flex-shrink-0 transition-transform group-hover:scale-110"
                style={{
                  background: systemPalette.base,
                  borderColor: isDefault ? systemPalette.dark : 'transparent',
                  boxShadow: isDefault ? `0 0 0 2px white, 0 0 0 4px ${systemPalette.base}` : 'none',
                }}
              />
              <div className="text-left">
                <p className="text-xs font-medium text-text-primary leading-none">Default</p>
                <p className="text-[10px] text-text-muted mt-0.5">Your community color</p>
              </div>
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                onClick={() => { onSelect(p.id); setOpen(false); }}
                title={p.name}
                className="flex flex-col items-center gap-1 group"
              >
                <span
                  className="w-8 h-8 rounded-full border-2 transition-transform group-hover:scale-110"
                  style={{
                    background: p.base,
                    borderColor: current.id === p.id ? p.dark : 'transparent',
                    boxShadow: current.id === p.id ? `0 0 0 2px white, 0 0 0 4px ${p.base}` : 'none',
                  }}
                />
                <span className="text-[10px] text-text-muted leading-none">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stat chip ──────────────────────────────────────────────────────────────

export function StatChip({
  icon, value, label, theme, onClick,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  theme: ThemePalette;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all hover:scale-105 active:scale-95 disabled:cursor-default"
      style={{ background: theme.light, color: theme.dark }}
      disabled={!onClick}
    >
      <span style={{ color: theme.base }}>{icon}</span>
      <span className="font-bold">{value}</span>
      <span className="text-xs opacity-70 hidden sm:inline">{label}</span>
    </button>
  );
}

// ─── Experience timeline item ───────────────────────────────────────────────

export function ExperienceItem({
  exp, isOwner, theme, onEdit, isLast,
}: {
  exp: WorkExperience;
  isOwner: boolean;
  theme: ThemePalette;
  onEdit: () => void;
  isLast: boolean;
}) {
  return (
    <div className="flex gap-4 group">
      <div className="flex flex-col items-center flex-shrink-0 w-4">
        <div
          className="w-3 h-3 rounded-full mt-0.5 ring-2 ring-surface-1 flex-shrink-0"
          style={{ background: theme.base }}
        />
        {!isLast && <div className="w-px flex-1 mt-1" style={{ background: theme.light }} />}
      </div>

      <div className={`flex-1 min-w-0 pb-5`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary leading-snug">{exp.title}</p>
            <p className="text-sm text-text-secondary mt-0.5">
              {exp.company}{exp.location ? ` · ${exp.location}` : ''}
            </p>
            <span
              className="inline-block mt-1 px-2 py-0.5 text-[11px] font-medium rounded-full"
              style={{ background: theme.light, color: theme.dark }}
            >
              {formatDateRange(exp.startDate, exp.endDate, exp.current)}
            </span>
            {exp.description && (
              <p className="text-sm text-text-muted mt-2 leading-relaxed whitespace-pre-line">
                {exp.description}
              </p>
            )}
          </div>
          {isOwner && (
            <button
              onClick={onEdit}
              className="flex-shrink-0 p-1.5 rounded-lg text-text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 transition-all"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Skills pill cloud ──────────────────────────────────────────────────────

export function SkillsPillCloud({ tags, theme }: { tags: string[]; theme: ThemePalette }) {
  const sizes = ['text-xs', 'text-[13px]', 'text-xs', 'text-[13px]', 'text-xs'];
  return (
    <div className="flex flex-wrap gap-1.5 px-5 pb-5">
      {tags.map((tag, i) => (
        <span
          key={tag}
          className={`px-3 py-1 font-medium rounded-full border transition-all hover:scale-105 cursor-default ${sizes[i % sizes.length]}`}
          style={{
            background: theme.light,
            color: theme.dark,
            borderColor: `${theme.base}40`,
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

// ─── Connections strip ──────────────────────────────────────────────────────

export function ConnectionAvatar({
  conn,
}: {
  conn: { id: string; name: string; image_url?: string; subtitle?: string };
}) {
  return (
    <div className="group flex-shrink-0 flex flex-col items-center gap-1 cursor-pointer" title={conn.name}>
      <div className="relative w-11 h-11 rounded-full overflow-hidden ring-2 ring-border-subtle group-hover:ring-brand-green transition-all group-hover:scale-110">
        {conn.image_url ? (
          <img src={conn.image_url} alt={conn.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-surface-3 flex items-center justify-center">
            <span className="text-[11px] font-bold text-text-muted">{initials(conn.name)}</span>
          </div>
        )}
      </div>
      <span className="text-[10px] text-text-muted truncate max-w-[44px] leading-tight">
        {conn.name.split(' ')[0]}
      </span>
    </div>
  );
}

// ─── Bio with expand/collapse ───────────────────────────────────────────────

export function BioText({ bio }: { bio: string }) {
  const [expanded, setExpanded] = useState(false);
  const threshold = 280;
  const long = bio.length > threshold;
  const displayed = long && !expanded ? bio.slice(0, threshold).trimEnd() + '…' : bio;

  return (
    <div>
      <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{displayed}</p>
      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex items-center gap-0.5 text-xs font-medium text-brand-dark-green hover:underline"
        >
          {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</> : <><ChevronDown className="w-3.5 h-3.5" /> Read more</>}
        </button>
      )}
    </div>
  );
}

// Re-export PROFICIENCY_LABELS for convenience
export { PROFICIENCY_LABELS };
