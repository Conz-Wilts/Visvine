'use client';

import React, { useState } from 'react';
import { X, ShieldCheck, Lock, Users } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { getInitials } from '@/lib/avatarUtils';
import type { ThemePalette } from '@/lib/profileTheme';

export interface ProfileSpace {
  id: string;
  name: string;
  imageUrl: string | null;
  emoji: string | null;
  visibility: string;
  memberCount: number;
  role: string;
  showOnProfile: boolean;
  visible: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  spaces: ProfileSpace[];
  /** Viewing your own profile — shows the per-space visibility toggles. */
  isOwner: boolean;
  personName: string;
  theme: ThemePalette;
  /** Owner only: persist a member space's show-on-profile flag. */
  onToggle?: (spaceId: string, showOnProfile: boolean) => Promise<void>;
}

export default function SpacesModal({ open, onClose, spaces, isOwner, personName, theme, onToggle }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!open) return null;

  const managed = spaces.filter((c) => c.role === 'admin');
  const memberOf = spaces.filter((c) => c.role !== 'admin');

  const toggle = async (c: ProfileSpace) => {
    if (!onToggle || busy) return;
    setBusy(c.id);
    try { await onToggle(c.id, !c.showOnProfile); } finally { setBusy(null); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-lg"
      panelClassName="bg-surface-1 border border-border-subtle rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle flex-shrink-0">
          <h2 className="text-base font-bold font-open-sauce text-text-primary">Spaces</h2>
          <button onClick={onClose} aria-label="Close"
                  className="p-1.5 rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-5">
          {managed.length > 0 && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted mb-2.5">
                Manages · {managed.length}
              </h3>
              <div className="flex flex-col gap-1.5">
                {managed.map((c) => (
                  <SpaceRow key={c.id} space={c} theme={theme}
                    trailing={isOwner
                      ? <span className="text-[11.5px] font-medium text-text-muted whitespace-nowrap">Always visible</span>
                      : <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold whitespace-nowrap" style={{ color: theme.dark }}>
                          <ShieldCheck className="w-3.5 h-3.5" /> Admin
                        </span>}
                  />
                ))}
              </div>
            </section>
          )}

          {memberOf.length > 0 && (isOwner || memberOf.some((c) => c.visible)) && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted mb-2.5">
                Member of · {isOwner ? memberOf.length : memberOf.filter((c) => c.visible).length}
              </h3>
              {isOwner && (
                <p className="text-xs text-text-muted mb-2.5 leading-relaxed">
                  Choose which of your spaces are visible on your public profile. Spaces you manage are always shown.
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                {(isOwner ? memberOf : memberOf.filter((c) => c.visible)).map((c) => (
                  <SpaceRow key={c.id} space={c} theme={theme} dimmed={isOwner && !c.showOnProfile}
                    trailing={isOwner ? (
                      <button role="switch" aria-checked={c.showOnProfile} disabled={busy === c.id}
                              aria-label={`Show ${c.name} on profile`}
                              onClick={() => toggle(c)}
                              className="relative w-9 h-5 flex-none rounded-full transition-colors disabled:opacity-50"
                              style={{ background: c.showOnProfile ? theme.base : 'var(--surface-3, #e5e7eb)' }}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${c.showOnProfile ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                    ) : null}
                  />
                ))}
              </div>
            </section>
          )}

          {spaces.length === 0 && (
            <p className="text-sm text-text-muted italic py-6 text-center">
              {personName} isn’t showing any spaces yet.
            </p>
          )}
        </div>
    </Modal>
  );
}

function SpaceRow({ space: c, theme, trailing, dimmed }: {
  space: ProfileSpace; theme: ThemePalette; trailing: React.ReactNode; dimmed?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 p-2.5 rounded-xl border border-border-subtle transition-opacity ${dimmed ? 'opacity-55' : ''}`}>
      {c.imageUrl ? (
        <img src={c.imageUrl} alt={c.name} className="w-10 h-10 rounded-lg object-cover flex-none" />
      ) : (
        <span className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold flex-none"
              style={{ background: theme.light, color: theme.dark }}>
          {c.emoji || getInitials(c.name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-semibold text-text-primary truncate">{c.name}</span>
          {c.visibility === 'private' && (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-text-muted bg-surface-2 border border-border-subtle rounded px-1.5 h-[18px] flex-none">
              <Lock className="w-2.5 h-2.5" /> Private
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          <Users className="w-3 h-3" /> {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
        </span>
      </div>
      {trailing}
    </div>
  );
}
