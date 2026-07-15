'use client';

import { useState } from 'react';
import { Community, CommunityFeatureConfig } from '@/lib/types';
import { FEATURES, NAV_HIDDEN_FEATURE_KEYS, isFeatureEnabled, isDirectoryPrivate, sortFeatureKeys, visibleFeatures } from '@/lib/features';
import Toggle from '@/components/ui/Toggle';
import { SettingsCard } from '@/components/ui';
import { useConsoleAutosave } from '@/components/console/ConsoleSaveContext';
import { fetchJsonBody } from '@/lib/fetchJson';

interface Props {
  community: Community;
  onSaved: (updated: Partial<Community>) => void;
}

const iconProps = {
  className: 'h-5 w-5',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  viewBox: '0 0 24 24',
} as const;

const ToolsIcon = () => (
  <svg {...iconProps}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
  </svg>
);
const PreviewIcon = () => (
  <svg {...iconProps}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const LockIcon = () => (
  <svg {...iconProps} className="h-3.5 w-3.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5v-6a1.5 1.5 0 011.5-1.5z" />
  </svg>
);
const GripIcon = () => (
  <svg {...iconProps} className="h-4 w-4" strokeWidth={1.5}>
    <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
  </svg>
);

/** Move `key` one slot up (-1) or down (+1); returns the list unchanged at the ends. */
function moveKey(order: string[], key: string, delta: -1 | 1): string[] {
  const from = order.indexOf(key);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Move `key` so it sits at `targetKey`'s slot, sliding the rest along. */
function reorderTo(order: string[], key: string, targetKey: string): string[] {
  const from = order.indexOf(key);
  const to = order.indexOf(targetKey);
  if (from === -1 || to === -1 || from === to) return order;
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export default function CommunityToolsPanel({ community, onSaved }: Props) {
  const savedConfig = (community.featureConfig ?? {}) as CommunityFeatureConfig;

  // Toggle state, seeded from the community's current config. Flips persist immediately.
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      FEATURES.filter(f => !f.core).map(f => [f.key, isFeatureEnabled(savedConfig, f.key)])
    )
  );
  const [directoryPrivate, setDirectoryPrivate] = useState(isDirectoryPrivate(savedConfig));
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Messages is always on and lives in the top bar — never a toggle, never ordered.
  const [order, setOrder] = useState<string[]>(() =>
    sortFeatureKeys(savedConfig, FEATURES.filter(f => f.key !== 'messages').map(f => f.key))
  );
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const { queue } = useConsoleAutosave(async (patch) => {
    const data = await fetchJsonBody<{ community: Partial<Community> }>(`/api/communities/${community.id}/settings`, 'PUT', patch);
    onSaved(data.community);
  });

  // The PUT replaces featureConfig wholesale, so every save must carry the
  // complete config — never just the field that changed.
  const commit = (
    nextEnabled: Record<string, boolean>,
    nextDirectoryPrivate: boolean,
    nextOrder: string[],
  ) => {
    setEnabled(nextEnabled);
    setDirectoryPrivate(nextDirectoryPrivate);
    setOrder(nextOrder);
    queue({
      featureConfig: { enabled: nextEnabled, directoryPrivate: nextDirectoryPrivate, order: nextOrder },
    });
  };

  const currentConfig: CommunityFeatureConfig = { enabled, directoryPrivate, order };
  // What a regular member's sidebar rail shows with the current config
  // (messages + notes are toggleable but nav-less — see NAV_HIDDEN_FEATURE_KEYS).
  const memberRail = visibleFeatures(currentConfig, false).filter(
    f => !NAV_HIDDEN_FEATURE_KEYS.includes(f.key)
  );
  const toolFeatures = order.map(key => FEATURES.find(f => f.key === key)!);
  // The rail's first entry is where members land — call that out on the row that
  // owns it, since it's the non-obvious consequence of reordering.
  const landingKey = memberRail[0]?.key ?? null;

  const handleDrop = (targetKey: string) => {
    if (draggingKey && draggingKey !== targetKey) {
      commit(enabled, directoryPrivate, reorderTo(order, draggingKey, targetKey));
    }
    setDraggingKey(null);
    setDragOverKey(null);
  };

  return (
    <div className="grid w-full grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <SettingsCard
        icon={<ToolsIcon />}
        title="Tools"
        description="Choose which tools members of this community can use, and drag to reorder them. The first tool members can see is where they land. Click a tool to see what it does."
        bodyClassName="divide-y divide-border-subtle"
      >
        {toolFeatures.map((feature, index) => {
          const isCore = feature.core === true;
          const expanded = expandedKey === feature.key;
          const isDragging = draggingKey === feature.key;
          const isDragOver = dragOverKey === feature.key && draggingKey !== feature.key;
          return (
            <div
              key={feature.key}
              onDragOver={e => { e.preventDefault(); setDragOverKey(feature.key); }}
              onDrop={e => { e.preventDefault(); handleDrop(feature.key); }}
              className={`py-3 first:pt-0 last:pb-0 transition-opacity ${isDragging ? 'opacity-40' : ''} ${
                isDragOver ? 'border-t-2 border-brand-green' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Drag handle. It's also a button so the list stays operable by
                    keyboard — native HTML5 drag has no keyboard equivalent. */}
                <button
                  type="button"
                  draggable
                  onDragStart={() => setDraggingKey(feature.key)}
                  onDragEnd={() => { setDraggingKey(null); setDragOverKey(null); }}
                  onKeyDown={e => {
                    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    commit(enabled, directoryPrivate, moveKey(order, feature.key, e.key === 'ArrowUp' ? -1 : 1));
                  }}
                  aria-label={`Reorder ${feature.label} (position ${index + 1} of ${toolFeatures.length}) — use arrow keys`}
                  className="shrink-0 cursor-grab rounded text-text-muted transition-colors hover:text-text-secondary focus-visible:text-text-secondary active:cursor-grabbing"
                >
                  <GripIcon />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedKey(expanded ? null : feature.key)}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors hover:bg-surface-2/60 -mx-1 px-1 py-1"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-secondary">
                    {feature.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                      {feature.label}
                      <svg
                        className={`h-3.5 w-3.5 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                      {feature.key === landingKey && (
                        <span className="rounded-full bg-brand-green/15 px-2 py-0.5 text-[10px] font-medium text-brand-green">
                          Members land here
                        </span>
                      )}
                    </span>
                    {isCore && <span className="block text-xs text-text-muted">Always on</span>}
                  </span>
                </button>
                <Toggle
                  checked={isCore ? true : enabled[feature.key] !== false}
                  disabled={isCore}
                  onChange={on => commit({ ...enabled, [feature.key]: on }, directoryPrivate, order)}
                  aria-label={`Toggle ${feature.label}`}
                />
              </div>

              {expanded && (
                <p className="mt-2 rounded-lg bg-surface-2/60 px-3 py-2 text-sm text-text-secondary">
                  {feature.description}
                </p>
              )}

              {feature.key === 'directory' && (
                <div className="mt-3 ml-12 flex items-start justify-between gap-3 rounded-xl border border-border-subtle p-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                      <LockIcon />
                      Admins only
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      Hidden from members&apos; sidebars; only admins can open the directory.
                    </span>
                  </span>
                  <Toggle
                    checked={directoryPrivate}
                    onChange={on => commit(enabled, on, order)}
                    aria-label="Make directory admins-only"
                  />
                </div>
              )}
            </div>
          );
        })}
      </SettingsCard>

      <SettingsCard
        icon={<PreviewIcon />}
        title="Sidebar preview"
        description="What a member of this community sees right now."
      >
        <div className="flex items-start gap-5">
          {/* Mini rail — mimics the floating sidebar geometry at reduced scale. */}
          <div className="flex w-16 shrink-0 flex-col items-center gap-1 rounded-2xl border border-border-subtle bg-surface-1 py-3 shadow-soft">
            {memberRail.map(f => (
              <span
                key={f.key}
                title={f.label}
                className="grid h-10 w-10 place-items-center rounded-lg text-text-secondary"
              >
                {f.icon}
              </span>
            ))}
            {memberRail.length === 0 && (
              <span className="px-2 py-1 text-center text-[10px] text-text-muted">No tools</span>
            )}
          </div>
          <div className="space-y-2 pt-1 text-xs text-text-muted">
            <ul className="space-y-1">
              {memberRail.map(f => (
                <li key={f.key} className="flex h-10 items-center text-sm text-text-secondary">{f.label}</li>
              ))}
            </ul>
            {directoryPrivate && (
              <p className="flex items-center gap-1.5">
                <LockIcon />
                Admins also see: Directory (admins only)
              </p>
            )}
            <p>Messages appears in the top bar.</p>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
