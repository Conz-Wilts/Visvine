'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { FEATURES, isFeatureEnabled } from '@/lib/features';
import type { CommunityFeatureConfig } from '@/lib/types';

/**
 * The "apps" launcher opened from the sidebar More button. Shows every optional
 * community surface as a card. Members tap a card to jump to that surface;
 * admins also get a toggle to switch each feature on or off for the whole
 * community (persisted via the settings route, then refreshed into context).
 */
export default function FeatureLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { currentCommunity, isAdmin, refreshCommunity } = useCommunity();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const toggleFeature = async (key: string, nextEnabled: boolean) => {
    if (!currentCommunity || savingKey) return;
    setError(null);
    setSavingKey(key);
    // Merge the new flag over the existing enabled map.
    const enabled: Record<string, boolean> = { ...(config?.enabled ?? {}), [key]: nextEnabled };
    try {
      const res = await fetch(`/api/communities/${currentCommunity.id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureConfig: { enabled } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update');
      }
      await refreshCommunity();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update feature');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border-subtle bg-surface-1 shadow-2xl"
        style={{ animation: 'modalIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both' }}
      >
        {/* Header */}
        <div className="relative flex items-center justify-center px-6 pt-6 pb-4 border-b border-border-subtle">
          <div className="text-center">
            <h2 className="font-semibold text-text-primary text-base">Community features</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {isAdmin
                ? 'Choose what this community includes. Changes apply for everyone.'
                : 'Jump to any part of this community.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="absolute right-6 w-8 h-8 rounded-full flex items-center justify-center bg-red-400 hover:scale-110 transition-transform"
            aria-label="Close"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Grid of feature cards */}
        <div className="px-6 py-5 grid grid-cols-2 gap-3">
          {FEATURES.map((f) => {
            const enabled = isFeatureEnabled(config, f.key);
            const active = pathname === f.href;
            const saving = savingKey === f.key;
            return (
              <div
                key={f.key}
                className={`relative rounded-xl border p-3.5 transition-colors ${
                  enabled
                    ? active
                      ? 'border-brand-green bg-brand-green/10'
                      : 'border-border-subtle bg-surface-2/40'
                    : 'border-dashed border-border-subtle bg-transparent opacity-60'
                }`}
              >
                {/* Card body — navigates when the feature is on */}
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => enabled && go(f.href)}
                  className="flex items-start gap-3 text-left w-full disabled:cursor-default"
                >
                  <span
                    className="flex items-center justify-center shrink-0 rounded-lg w-9 h-9 text-text-secondary"
                    style={{ background: 'var(--color-surface-2, #f1f1f1)' }}
                  >
                    {f.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                      {f.label}
                      {f.core && (
                        <span className="text-[9px] font-medium uppercase tracking-wide text-text-muted border border-border-subtle rounded px-1 py-px">
                          Core
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] leading-snug text-text-muted mt-0.5">
                      {f.description}
                    </span>
                  </span>
                </button>

                {/* Admin toggle (hidden for core features, which can't be turned off) */}
                {isAdmin && !f.core && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => toggleFeature(f.key, !enabled)}
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${enabled ? 'Disable' : 'Enable'} ${f.label}`}
                    className="absolute top-3 right-3 w-9 h-5 rounded-full transition-colors disabled:opacity-50"
                    style={{ background: enabled ? 'var(--color-brand-green, #78d870)' : 'var(--color-border-default, #d4d4d4)' }}
                  >
                    <span
                      className="block w-4 h-4 rounded-full bg-white shadow transition-transform"
                      style={{ transform: enabled ? 'translateX(18px)' : 'translateX(2px)' }}
                    />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <p className="mx-6 mb-4 text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
