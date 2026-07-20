'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Community, CommunityFeatureConfig } from '@/lib/types';
import { FEATURES, isFeatureEnabled, isDirectoryPrivate, moreFeatureKeys, moreFeatures, railFeatures, sortFeatureKeys } from '@/lib/features';
import Toggle from '@/components/ui/Toggle';
import { SettingsSection } from '@/components/ui';
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
// 3x3 dot grid — same glyph as the sidebar's "More" item.
const MoreDotsIcon = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <circle cx="5" cy="5" r="1.6" /><circle cx="12" cy="5" r="1.6" /><circle cx="19" cy="5" r="1.6" />
    <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    <circle cx="5" cy="19" r="1.6" /><circle cx="12" cy="19" r="1.6" /><circle cx="19" cy="19" r="1.6" />
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
  // Keys tucked into the sidebar's "More" popup. Membership only — order still
  // comes from `order` above.
  const [more, setMore] = useState<string[]>(() => moreFeatureKeys(savedConfig));
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  // FLIP reorder animation: snapshot every [data-flip-key] element's position
  // right before a reorder commits, then after React re-renders slide each
  // element from its old slot to its new one. In 'pop' mode (keyboard moves)
  // the moved row also gets a pop + glow; in 'drag' mode the dragged row is
  // excluded — it's already floating under the cursor via an inline transform.
  const flipRoot = useRef<HTMLDivElement>(null);
  const flipSnapshot = useRef<Map<string, DOMRect> | null>(null);
  const flipMovedKey = useRef<string | null>(null);
  const flipMode = useRef<'pop' | 'drag'>('pop');

  const captureFlip = (movedKey: string, mode: 'pop' | 'drag' = 'pop') => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rects = new Map<string, DOMRect>();
    flipRoot.current?.querySelectorAll<HTMLElement>('[data-flip-key]').forEach(el => {
      rects.set(el.dataset.flipKey!, el.getBoundingClientRect());
    });
    flipSnapshot.current = rects;
    flipMovedKey.current = movedKey;
    flipMode.current = mode;
  };

  useLayoutEffect(() => {
    const prev = flipSnapshot.current;
    if (!prev) return;
    const movedKey = flipMovedKey.current;
    const mode = flipMode.current;
    flipSnapshot.current = null;
    flipMovedKey.current = null;
    flipRoot.current?.querySelectorAll<HTMLElement>('[data-flip-key]').forEach(el => {
      const flipKey = el.dataset.flipKey!;
      if (mode === 'drag' && flipKey === `row:${movedKey}`) return;
      const before = prev.get(flipKey);
      if (!before) return;
      const dy = before.top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      const moved = mode === 'pop' && flipKey.endsWith(`:${movedKey}`);
      el.animate(
        moved
          ? [
              { transform: `translateY(${dy}px) scale(1)`, offset: 0 },
              { transform: `translateY(${dy * 0.4}px) scale(1.03)`, offset: 0.4 },
              { transform: 'translateY(0) scale(1)', offset: 1 },
            ]
          : [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
        { duration: moved ? 420 : 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
      if (moved && flipKey.startsWith('row:')) {
        el.animate(
          [
            { boxShadow: '0 0 0 0 rgba(34, 197, 94, 0)', borderRadius: '12px' },
            { boxShadow: '0 8px 24px -6px rgba(34, 197, 94, 0.35)', borderRadius: '12px', offset: 0.4 },
            { boxShadow: '0 0 0 0 rgba(34, 197, 94, 0)', borderRadius: '12px' },
          ],
          { duration: 600, easing: 'ease-out' },
        );
      }
    });
  }, [order]);

  // Pointer-driven drag: the grabbed card floats with the cursor (inline
  // translateY on the row) while the other rows FLIP out of its way live.
  // Refs, not state, so pointermove never waits on a re-render.
  const dragState = useRef<{ key: string; grabOffset: number; el: HTMLElement; initialOrder: string[] } | null>(null);
  const dragTranslate = useRef(0);
  const orderRef = useRef(order);
  orderRef.current = order;

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, key: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-flip-key^="row:"]');
    if (!row) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      key,
      grabOffset: e.clientY - row.getBoundingClientRect().top,
      el: row,
      initialOrder: orderRef.current,
    };
    dragTranslate.current = 0;
    setDraggingKey(key);
  };

  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    // The row's layout slot shifts when the list reorders under it, so derive
    // it fresh each move: on-screen top minus the transform we applied.
    const baseTop = drag.el.getBoundingClientRect().top - dragTranslate.current;
    const translate = e.clientY - drag.grabOffset - baseTop;
    dragTranslate.current = translate;
    drag.el.style.transform = `translateY(${translate}px) scale(1.02)`;

    const rows = flipRoot.current?.querySelectorAll<HTMLElement>('[data-flip-key^="row:"]') ?? [];
    const from = orderRef.current.indexOf(drag.key);
    for (const other of rows) {
      const otherKey = other.dataset.flipKey!.slice('row:'.length);
      if (otherKey === drag.key) continue;
      const r = other.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const to = orderRef.current.indexOf(otherKey);
      if ((to < from && e.clientY < mid) || (to > from && e.clientY > mid)) {
        captureFlip(drag.key, 'drag');
        setOrder(reorderTo(orderRef.current, drag.key, otherKey));
        break;
      }
    }
  };

  const endDrag = () => {
    const drag = dragState.current;
    if (!drag) return;
    dragState.current = null;
    const translate = dragTranslate.current;
    dragTranslate.current = 0;
    drag.el.style.transform = '';
    if (Math.abs(translate) > 1) {
      // Settle the card from wherever the cursor left it into its new slot.
      drag.el.animate(
        [{ transform: `translateY(${translate}px) scale(1.02)` }, { transform: 'translateY(0) scale(1)' }],
        { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
    setDraggingKey(null);
    if (orderRef.current.join() !== drag.initialOrder.join()) {
      commit(enabled, directoryPrivate, orderRef.current, more);
    }
  };

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
    nextMore: string[],
  ) => {
    setEnabled(nextEnabled);
    setDirectoryPrivate(nextDirectoryPrivate);
    setOrder(nextOrder);
    setMore(nextMore);
    queue({
      featureConfig: { enabled: nextEnabled, directoryPrivate: nextDirectoryPrivate, order: nextOrder, more: nextMore },
    });
  };

  const currentConfig: CommunityFeatureConfig = { enabled, directoryPrivate, order, more };
  // What a regular member's sidebar shows with the current config, split into
  // the rail and the "More" popup (messages is toggleable but nav-less).
  const memberRail = railFeatures(currentConfig, false);
  const memberMore = moreFeatures(currentConfig, false);
  const toolFeatures = order.map(key => FEATURES.find(f => f.key === key)!);
  // The rail's first entry is where members land — call that out on the row that
  // owns it, since it's the non-obvious consequence of reordering. With every
  // tool tucked into More, they land on the first More tool instead.
  const landingKey = memberRail[0]?.key ?? memberMore[0]?.key ?? null;

  return (
    <div ref={flipRoot} className="w-full space-y-8">
      <SettingsSection
        title="Tools"
        description="Choose which tools members of this community can use, and drag to reorder them. The first tool members can see is where they land. Click a tool to see what it does. Use the dot-grid button to tuck a tool into the sidebar's More popup and keep the rail compact."
      >
        <div className="divide-y divide-border-subtle">
        {toolFeatures.map((feature, index) => {
          const isCore = feature.core === true;
          const expanded = expandedKey === feature.key;
          const isDragging = draggingKey === feature.key;
          return (
            <div
              key={feature.key}
              data-flip-key={`row:${feature.key}`}
              className={`py-3 first:pt-0 last:pb-0 ${
                isDragging
                  ? 'relative z-10 -mx-3 rounded-xl !border-transparent bg-surface-1 px-3 shadow-xl ring-1 ring-border-subtle'
                  : ''
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Drag handle. It's also a button so the list stays operable by
                    keyboard — native HTML5 drag has no keyboard equivalent. */}
                <button
                  type="button"
                  onPointerDown={e => startDrag(e, feature.key)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={e => {
                    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    captureFlip(feature.key);
                    commit(enabled, directoryPrivate, moveKey(order, feature.key, e.key === 'ArrowUp' ? -1 : 1), more);
                  }}
                  aria-label={`Reorder ${feature.label} (position ${index + 1} of ${toolFeatures.length}) — use arrow keys`}
                  className="shrink-0 cursor-grab touch-none rounded text-text-muted transition-colors hover:text-text-secondary focus-visible:text-text-secondary active:cursor-grabbing"
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
                {/* Tuck into / pull out of the sidebar's "More" popup. Placement,
                    not enablement — works for core tools too. */}
                <button
                  type="button"
                  onClick={() =>
                    commit(
                      enabled,
                      directoryPrivate,
                      order,
                      more.includes(feature.key) ? more.filter(k => k !== feature.key) : [...more, feature.key],
                    )
                  }
                  aria-pressed={more.includes(feature.key)}
                  aria-label={`Show ${feature.label} in the sidebar's More popup`}
                  title={more.includes(feature.key) ? 'In More — click to show in the sidebar' : 'Move into the sidebar’s More popup'}
                  className={`shrink-0 rounded-lg p-1.5 transition-colors ${
                    more.includes(feature.key)
                      ? 'bg-brand-green/15 text-brand-green'
                      : 'text-text-muted hover:bg-surface-2/60 hover:text-text-secondary'
                  }`}
                >
                  <MoreDotsIcon />
                </button>
                <Toggle
                  checked={isCore ? true : enabled[feature.key] !== false}
                  disabled={isCore}
                  onChange={on => commit({ ...enabled, [feature.key]: on }, directoryPrivate, order, more)}
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
                    onChange={on => commit(enabled, on, order, more)}
                    aria-label="Make directory admins-only"
                  />
                </div>
              )}
            </div>
          );
        })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Sidebar preview"
        description="What a member of this community sees right now."
      >
        <div className="flex items-start gap-5">
          {/* Mini rail — mimics the floating sidebar geometry at reduced scale. */}
          <div className="flex w-16 shrink-0 flex-col items-center gap-1 rounded-2xl border border-border-subtle bg-surface-1 py-3 shadow-soft">
            {memberRail.map(f => (
              <span
                key={f.key}
                data-flip-key={`rail:${f.key}`}
                title={f.label}
                className="grid h-10 w-10 place-items-center rounded-lg text-text-secondary"
              >
                {f.icon}
              </span>
            ))}
            {memberMore.length > 0 && (
              <span title="More" className="grid h-10 w-10 place-items-center rounded-lg text-text-secondary">
                <MoreDotsIcon className="h-5 w-5" />
              </span>
            )}
            {memberRail.length === 0 && memberMore.length === 0 && (
              <span className="px-2 py-1 text-center text-[10px] text-text-muted">No tools</span>
            )}
          </div>
          <div className="space-y-2 pt-1 text-xs text-text-muted">
            <ul className="space-y-1">
              {memberRail.map(f => (
                <li key={f.key} data-flip-key={`label:${f.key}`} className="flex h-10 items-center text-sm text-text-secondary">{f.label}</li>
              ))}
              {memberMore.length > 0 && (
                <li className="flex h-10 items-center gap-1.5 text-sm text-text-secondary">
                  More
                  <span className="text-xs text-text-muted">({memberMore.map(f => f.label).join(', ')})</span>
                </li>
              )}
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
      </SettingsSection>
    </div>
  );
}
