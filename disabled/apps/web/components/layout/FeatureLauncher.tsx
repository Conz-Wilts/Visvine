'use client';

import { useEffect, useRef, useState } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { FEATURES, isFeatureEnabled } from '@/lib/features';
import type { CommunityFeatureConfig } from '@/lib/types';

/**
 * The "apps" launcher opened from the sidebar More button. Lists only the
 * optional community surfaces that are NOT already in the sidebar (i.e. the
 * features that are currently switched off). Admins can add any of them to the
 * community (persisted via the settings route, then refreshed into context);
 * there is no remove/disable control here — turning a feature off is not done
 * from More.
 */
export default function FeatureLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentCommunity, isAdmin, refreshCommunity } = useCommunity();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;
  // Features that aren't in the sidebar yet — switched-off, non-core surfaces.
  const available = FEATURES.filter((f) => !f.core && !isFeatureEnabled(config, f.key));

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  // Admins can only ADD features here (turn them on). There is no disable path
  // from More — a feature is removed elsewhere, not from this launcher.
  const addFeature = async (key: string) => {
    if (!currentCommunity || savingKey) return;
    setError(null);
    setSavingKey(key);
    // Merge the new flag over the existing enabled map.
    const enabled: Record<string, boolean> = { ...(config?.enabled ?? {}), [key]: true };
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
            <h2 className="font-semibold text-text-primary text-base">Add features</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {isAdmin
                ? 'More surfaces you can add to this community. Changes apply for everyone.'
                : 'More surfaces this community could add.'}
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

        {/* Only the features that are NOT already in the sidebar (i.e. switched
            off). Core features are always in the sidebar, so never listed here. */}
        {available.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-text-muted">
            Every feature is already in your sidebar.
          </div>
        ) : (
          <div className="px-6 py-5 grid grid-cols-2 gap-3">
            {available.map((f) => {
              const saving = savingKey === f.key;
              return (
                <div
                  key={f.key}
                  className="relative rounded-xl border border-dashed border-border-subtle bg-transparent p-3.5"
                >
                  <div className="flex items-start gap-3 text-left w-full">
                    <span
                      className="flex items-center justify-center shrink-0 rounded-lg w-9 h-9 text-text-secondary"
                      style={{ background: 'var(--color-surface-2, #f1f1f1)' }}
                    >
                      {f.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-text-primary">
                        {f.label}
                      </span>
                      <span className="block text-[11px] leading-snug text-text-muted mt-0.5">
                        {f.description}
                      </span>
                    </span>
                  </div>

                  {/* Admins can add the feature to the community. No remove here. */}
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => addFeature(f.key)}
                      className="mt-3 w-full rounded-lg border border-brand-green text-brand-green text-xs font-semibold py-1.5 transition-colors hover:bg-brand-green/10 disabled:opacity-50"
                    >
                      {saving ? 'Adding…' : 'Add to community'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

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
