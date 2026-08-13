'use client';

// Members → Tools. Which tools a member can open at all.
//
// This is a permission, not a layout choice, so it sits with the other
// permissions rather than on the Tools tab — that one decides which tools the
// space HAS and what order they sit in the sidebar; this one decides who gets to
// see them. The two write different keys of the same featureConfig column, which
// the settings route merges rather than replaces.

import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { Space, SpaceFeatureConfig } from '@/lib/types';
import {
  ADMIN_ONLY_FEATURE_KEYS,
  FEATURES,
  NAV_HIDDEN_FEATURE_KEYS,
  adminOnlyFeatureKeys,
  isFeatureEnabled,
  sortFeatureKeys,
} from '@/features/shared/lib/features';
import Toggle from '@/components/ui/Toggle';
import { useConsoleAutosave } from '@/features/admin/components/console/ConsoleSaveContext';
import { fetchJsonBody } from '@/lib/fetchJson';

export default function ToolAccessTab({ space, onSaved }: {
  space: Space;
  onSaved: (updated: Partial<Space>) => void;
}) {
  const savedConfig = (space.featureConfig ?? {}) as SpaceFeatureConfig;
  const [adminOnly, setAdminOnly] = useState<string[]>(() => adminOnlyFeatureKeys(savedConfig));

  const { queue } = useConsoleAutosave(async (patch) => {
    const data = await fetchJsonBody<{ space: Partial<Space> }>(
      `/api/communities/${space.id}/settings`, 'PUT', patch,
    );
    onSaved(data.space);
  });

  // Only `adminOnly` goes up: the Tools tab owns enabled/order/more, and the
  // route merges this patch over what's stored.
  const setToolAdminOnly = (key: string, on: boolean) => {
    const next = on ? [...adminOnly, key] : adminOnly.filter((k) => k !== key);
    setAdminOnly(next);
    queue({ featureConfig: { adminOnly: next } });
  };

  // Tools the space doesn't have, and the ones with no page of their own, have
  // nothing to restrict. Shown in the sidebar's own order so the list reads the
  // way the rail does.
  const keys = sortFeatureKeys(
    savedConfig,
    FEATURES.filter(
      (f) => !NAV_HIDDEN_FEATURE_KEYS.includes(f.key) && isFeatureEnabled(savedConfig, f.key),
    ).map((f) => f.key),
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        Every tool is open to everyone in the space unless you lock it. A locked tool disappears
        from a member&apos;s sidebar and refuses them if they go looking for it.
      </p>

      <div className="divide-y divide-border-subtle">
        {keys.map((key) => {
          const feature = FEATURES.find((f) => f.key === key)!;
          const always = ADMIN_ONLY_FEATURE_KEYS.includes(key);
          const locked = adminOnly.includes(key);
          return (
            <div key={key} className="flex items-center gap-3 py-3">
              <span className="shrink-0 text-text-secondary">{feature.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-primary">{feature.label}</div>
                <div className="truncate text-xs text-text-muted">
                  {always
                    ? `${feature.label} is always admins only.`
                    : locked
                      ? 'Admins only.'
                      : 'Everyone in this space.'}
                </div>
              </div>
              <span
                className={`flex shrink-0 items-center gap-1.5 ${
                  locked ? 'text-text-secondary' : 'text-text-muted'
                }`}
                title={
                  always
                    ? `${feature.label} is always admins-only`
                    : `Only admins can open ${feature.label}`
                }
              >
                <Lock className="h-3.5 w-3.5" />
                <Toggle
                  checked={locked}
                  disabled={always}
                  onChange={(on) => setToolAdminOnly(key, on)}
                  aria-label={`Restrict ${feature.label} to admins`}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
