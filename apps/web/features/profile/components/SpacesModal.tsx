'use client';

import React, { useState } from 'react';
import { LockIcon, ShieldCheckIcon, UsersIcon } from '@/features/shared/icons';
import { Modal, getInitials } from '@visvine/ui';
import type { ThemePalette } from '@/lib/profileTheme';

export interface ProfileSpace {
  id: string;
  name: string;
  imageUrl: string | null;
  visibility: string;
  memberCount: number;
  /** Whether this person holds an alias that manages the space. */
  isAdmin: boolean;
  showOnProfile: boolean;
  visible: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  spaces: ProfileSpace[];
  /** Viewing your own profile — shows the per-space visibility toggles. */
  isOwner: boolean;
  theme: ThemePalette;
  /** Owner only: persist a member space's show-on-profile flag. */
  onToggle?: (spaceId: string, showOnProfile: boolean) => Promise<void>;
}

export default function SpacesModal({ open, onClose, spaces, isOwner, theme, onToggle }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!open) return null;

  const managed = spaces.filter((c) => c.isAdmin);
  const memberOf = spaces.filter((c) => !c.isAdmin);

  const toggle = async (c: ProfileSpace) => {
    if (!onToggle || busy) return;
    setBusy(c.id);
    try { await onToggle(c.id, !c.showOnProfile); } finally { setBusy(null); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Spaces" size="sm">
        <div className="flex flex-col gap-5 px-6 py-4">
          {managed.length > 0 && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-muted mb-2.5">
                Manages · {managed.length}
              </h3>
              <div className="flex flex-col">
                {managed.map((c) => (
                  <SpaceRow key={c.id} space={c} theme={theme}
                    trailing={isOwner
                      ? null
                      : <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold whitespace-nowrap" style={{ color: theme.dark }}>
                          <ShieldCheckIcon className="w-3.5 h-3.5" /> Admin
                        </span>}
                  />
                ))}
              </div>
            </section>
          )}

          {memberOf.length > 0 && (isOwner || memberOf.some((c) => c.visible)) && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-muted mb-2.5">
                Member of · {isOwner ? memberOf.length : memberOf.filter((c) => c.visible).length}
              </h3>
              <div className="flex flex-col">
                {(isOwner ? memberOf : memberOf.filter((c) => c.visible)).map((c) => (
                  <SpaceRow key={c.id} space={c} theme={theme} dimmed={isOwner && !c.showOnProfile}
                    trailing={isOwner ? (
                      <button role="switch" aria-checked={c.showOnProfile} disabled={busy === c.id}
                              aria-label={`Show ${c.name} on profile`}
                              onClick={() => toggle(c)}
                              className="relative w-9 h-5 flex-none rounded-full transition-colors disabled:opacity-50"
                              style={{ background: c.showOnProfile ? theme.base : 'var(--vv-color-surface-muted)' }}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-surface shadow transition-all ${c.showOnProfile ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                    ) : null}
                  />
                ))}
              </div>
            </section>
          )}

          {spaces.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-muted">No spaces</p>
          )}
        </div>
    </Modal>
  );
}

function SpaceRow({ space: c, theme, trailing, dimmed }: {
  space: ProfileSpace; theme: ThemePalette; trailing: React.ReactNode; dimmed?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 py-1.5 transition-opacity ${dimmed ? 'opacity-55' : ''}`}>
      {c.imageUrl ? (
        <img src={c.imageUrl} alt={c.name} className="w-10 h-10 rounded-lg object-cover flex-none" />
      ) : (
        <span className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold flex-none"
              style={{ background: theme.light, color: theme.dark }}>
          {getInitials(c.name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-semibold text-fg truncate">{c.name}</span>
          {c.visibility === 'private' && (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-fg-muted bg-surface-subtle border border-line-subtle rounded px-1.5 h-[18px] flex-none">
              <LockIcon className="w-2.5 h-2.5" /> Private
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
          <UsersIcon className="w-3 h-3" /> {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
        </span>
      </div>
      {trailing}
    </div>
  );
}
