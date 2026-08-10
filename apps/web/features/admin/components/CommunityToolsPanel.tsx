'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Community, CommunityFeatureConfig } from '@/lib/types';
import { ADMIN_ONLY_FEATURE_KEYS, FEATURES, NAV_HIDDEN_FEATURE_KEYS, adminOnlyFeatureKeys, featureNodeTypeNames, isFeatureEnabled, moreFeatureKeys, sortFeatureKeys } from '@/features/shared/lib/features';
import Toggle from '@/components/ui/Toggle';
import { Modal, SearchInput, SettingsSection } from '@/components/ui';
import { useConsoleAutosave } from '@/features/admin/components/console/ConsoleSaveContext';
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
const PlusIcon = () => (
  <svg {...iconProps} className="h-4 w-4" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
  </svg>
);
// 3x3 dot grid — same glyph as the sidebar's "More" item.
const MoreDotsIcon = () => (
  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
    <circle cx="5" cy="5" r="1.6" /><circle cx="12" cy="5" r="1.6" /><circle cx="19" cy="5" r="1.6" />
    <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    <circle cx="5" cy="19" r="1.6" /><circle cx="12" cy="19" r="1.6" /><circle cx="19" cy="19" r="1.6" />
  </svg>
);

/**
 * Sentinel item standing in for the "More" divider inside the dragged sequence.
 * Not a feature key — it can never collide with one.
 */
const MORE_DIVIDER = '__more__';

/** Pixels a press has to travel before it counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

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

/** "Space and Channel types" — names what a tool carries in or out with it. */
function typeNamesPhrase(featureKey: string): string | null {
  const names = featureNodeTypeNames(featureKey);
  if (names.length === 0) return null;
  if (names.length === 1) return `the ${names[0]} type`;
  return `the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} types`;
}

export default function CommunityToolsPanel({ community, onSaved }: Props) {
  const savedConfig = (community.featureConfig ?? {}) as CommunityFeatureConfig;

  // Which tools the community has added, seeded from its current config. Adds
  // and removes persist immediately; a removed tool takes its node types with it
  // (isNodeTypeEnabled reads the same `enabled` map).
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      FEATURES.filter(f => !f.core).map(f => [f.key, isFeatureEnabled(savedConfig, f.key)])
    )
  );
  // Tools only admins can see. Per-tool now, not just the directory.
  const [adminOnly, setAdminOnly] = useState<string[]>(() => adminOnlyFeatureKeys(savedConfig));
  // Nav-hidden features (Messages and Events in the top bar, Context under the
  // Directory) are never a toggle and never ordered here — see NAV_HIDDEN_FEATURE_KEYS.
  const [order, setOrder] = useState<string[]>(() =>
    sortFeatureKeys(savedConfig, FEATURES.filter(f => !NAV_HIDDEN_FEATURE_KEYS.includes(f.key)).map(f => f.key))
  );
  // Keys tucked into the sidebar's "More" popup. Membership is positional in the
  // UI — a row below the More divider is in More — but stored as its own list.
  const [more, setMore] = useState<string[]>(() => moreFeatureKeys(savedConfig));
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  // The row whose Remove button is awaiting confirmation. Removing hides a
  // surface and its node types community-wide, so it asks first.
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
  // The "Add tool" picker. Tools a community hasn't added live in here rather
  // than on the page — the panel shows what's on, not the whole catalogue.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

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
  }, [order, more]);

  // Pointer-driven drag: the grabbed card floats with the cursor (inline
  // translateY on the row) while the other rows FLIP out of its way live.
  // Refs, not state, so pointermove never waits on a re-render.
  const dragState = useRef<{ key: string; grabOffset: number; el: HTMLElement; initialSequence: string[] } | null>(null);
  const dragTranslate = useRef(0);
  const orderRef = useRef(order);
  orderRef.current = order;
  const moreRef = useRef(more);
  moreRef.current = more;

  // `order` carries every tool, added or not; only added ones have a row.
  const isAdded = (key: string) =>
    FEATURES.find(f => f.key === key)?.core === true || enabled[key] !== false;
  const addedKeys = order.filter(key => isAdded(key));
  const removedKeys = order.filter(key => !isAdded(key));
  // Two rendered lists — the sidebar rail and the More block — modelled as one
  // sequence with a sentinel between them, so a drag from one section to the
  // other is the same operation as a reorder within one.
  const railKeys = addedKeys.filter(key => !more.includes(key));
  const moreKeys = addedKeys.filter(key => more.includes(key));
  const sequence = [...railKeys, MORE_DIVIDER, ...moreKeys];
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;
  const removedRef = useRef(removedKeys);
  removedRef.current = removedKeys;

  /**
   * A press anywhere on a row arms a drag; it only becomes one once the pointer
   * travels past DRAG_THRESHOLD, so a stray click never nudges the order. The
   * controls that live on the row (the admins-only toggle, the remove button)
   * opt out with data-no-drag.
   */
  const pressState = useRef<{ key: string; startY: number; pointerId: number; el: HTMLElement; grabOffset: number } | null>(null);

  const pressRow = (e: React.PointerEvent<HTMLDivElement>, key: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    pressState.current = {
      key,
      startY: e.clientY,
      pointerId: e.pointerId,
      el: e.currentTarget,
      grabOffset: e.clientY - e.currentTarget.getBoundingClientRect().top,
    };
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    const press = pressState.current;
    if (press && !dragState.current) {
      if (Math.abs(e.clientY - press.startY) < DRAG_THRESHOLD) return;
      press.el.setPointerCapture(press.pointerId);
      dragState.current = {
        key: press.key,
        grabOffset: press.grabOffset,
        el: press.el,
        initialSequence: sequenceRef.current,
      };
      dragTranslate.current = 0;
      setDraggingKey(press.key);
    }
    const drag = dragState.current;
    if (!drag) return;
    // The row's layout slot shifts when the list reorders under it, so derive
    // it fresh each move: on-screen top minus the transform we applied.
    const baseTop = drag.el.getBoundingClientRect().top - dragTranslate.current;
    const translate = e.clientY - drag.grabOffset - baseTop;
    dragTranslate.current = translate;
    drag.el.style.transform = `translateY(${translate}px) scale(1.02)`;

    // The More divider is a row like any other here, so dragging past it both
    // reorders and moves the tool in or out of the More popup.
    const rows = flipRoot.current?.querySelectorAll<HTMLElement>('[data-flip-key^="row:"]') ?? [];
    const from = sequenceRef.current.indexOf(drag.key);
    for (const other of rows) {
      const otherKey = other.dataset.flipKey!.slice('row:'.length);
      if (otherKey === drag.key) continue;
      const r = other.getBoundingClientRect();
      // The More block is a container, not a row: its top edge is the boundary
      // between the two sections, so crossing it — not its midpoint — is what
      // moves a tool in or out. Otherwise reordering inside More would pop the
      // row back onto the rail halfway down the block.
      const mid = otherKey === MORE_DIVIDER ? r.top : r.top + r.height / 2;
      const to = sequenceRef.current.indexOf(otherKey);
      if ((to < from && e.clientY < mid) || (to > from && e.clientY > mid)) {
        captureFlip(drag.key, 'drag');
        applySequence(reorderTo(sequenceRef.current, drag.key, otherKey), false);
        break;
      }
    }
  };

  const endDrag = () => {
    pressState.current = null;
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
    // Drag moves only touched local state; persist once, when the row is dropped.
    if (sequenceRef.current.join() !== drag.initialSequence.join()) {
      commit(enabled, adminOnly, orderRef.current, moreRef.current);
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
    nextAdminOnly: string[],
    nextOrder: string[],
    nextMore: string[],
  ) => {
    setEnabled(nextEnabled);
    setAdminOnly(nextAdminOnly);
    setOrder(nextOrder);
    setMore(nextMore);
    queue({
      featureConfig: { enabled: nextEnabled, adminOnly: nextAdminOnly, order: nextOrder, more: nextMore },
    });
  };

  /**
   * Split a dragged sequence back into order + More membership. `persist` is
   * false for the live moves inside a drag — endDrag saves once on drop.
   */
  const applySequence = (seq: string[], persist: boolean) => {
    const cut = seq.indexOf(MORE_DIVIDER);
    const nextMore = seq.slice(cut + 1);
    const nextOrder = [...seq.slice(0, cut), ...nextMore, ...removedRef.current];
    if (persist) {
      commit(enabled, adminOnly, nextOrder, nextMore);
    } else {
      setOrder(nextOrder);
      setMore(nextMore);
    }
  };

  /** Add a tool back: it lands at the end of the rail, above the More divider. */
  const addTool = (key: string) => {
    commit(
      { ...enabled, [key]: true },
      adminOnly,
      [...addedKeys.filter(k => !more.includes(k)), key, ...more, ...removedKeys.filter(k => k !== key)],
      more,
    );
  };

  /** Remove a tool: its nav row, its pages and its node types all go with it. */
  const removeTool = (key: string) => {
    setConfirmRemoveKey(null);
    commit(
      { ...enabled, [key]: false },
      // Admins-only is placement on a row that no longer exists — drop it too.
      adminOnly.filter(k => k !== key),
      [...addedKeys.filter(k => k !== key), key, ...removedKeys],
      // A removed tool has no sidebar row left to tuck away.
      more.filter(k => k !== key),
    );
  };

  /** Flip a tool between "everyone" and "admins only". */
  const setToolAdminOnly = (key: string, on: boolean) =>
    commit(enabled, on ? [...adminOnly, key] : adminOnly.filter(k => k !== key), order, more);

  const availableFeatures = removedKeys.map(key => FEATURES.find(f => f.key === key)!);
  // Search matches the label, the blurb and the node type names, so "space"
  // finds Channels even though no tool is called that.
  const pickerResults = availableFeatures.filter(feature => {
    const query = pickerQuery.trim().toLowerCase();
    if (!query) return true;
    return [feature.label, feature.description, ...featureNodeTypeNames(feature.key)]
      .some(text => text.toLowerCase().includes(query));
  });
  /** One tool row. Rendered in both the rail list and the More block. */
  const renderToolRow = (item: string) => {
    const feature = FEATURES.find(f => f.key === item)!;
    const isCore = feature.core === true;
    // Position across both lists — arrow keys walk the whole sequence, crossing
    // into and out of More on the way.
    const position = sequence.indexOf(feature.key) + 1;
    const isDragging = draggingKey === feature.key;
    return (
      <div
        key={feature.key}
        data-flip-key={`row:${feature.key}`}
        // The whole card is the drag handle — press anywhere on it and move.
        onPointerDown={e => pressRow(e, feature.key)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // Even padding on every row — trimming the first and last would leave
        // the dividers unevenly spaced.
        className={`cursor-grab select-none py-3 ${
          isDragging
            ? 'relative z-10 -mx-3 cursor-grabbing rounded-xl !border-transparent bg-surface-1 px-3 shadow-xl ring-1 ring-border-subtle'
            : ''
        }`}
      >
        <div className="flex items-center gap-3">
          {/* Grip. Cosmetic for the mouse — the whole row drags — but it's a
              real button so the list stays operable by keyboard, which native
              drag has no equivalent for. */}
          <button
            type="button"
            onKeyDown={e => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              captureFlip(feature.key);
              // Stepping past the end of a list is what moves a tool in or out
              // of More — the keyboard equivalent of dragging between the two
              // sections.
              applySequence(moveKey(sequence, feature.key, e.key === 'ArrowUp' ? -1 : 1), true);
            }}
            aria-label={`Reorder ${feature.label} (position ${position} of ${sequence.length}) — use arrow keys`}
            className="shrink-0 rounded text-text-muted transition-colors hover:text-text-secondary focus-visible:text-text-secondary"
          >
            <GripIcon />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="shrink-0 text-text-secondary">
              {feature.icon}
            </span>
            <span className="min-w-0 truncate text-sm font-medium text-text-primary">
              {feature.label}
            </span>
          </div>
          {/* Admins only — members get neither the sidebar row nor the
              page. Visibility, not enablement, so core tools have it too. A
              tool whose pages refuse a member outright is locked on: there's
              nothing for the switch to decide. */}
          <span
            data-no-drag
            className={`flex shrink-0 items-center gap-1.5 ${
              adminOnly.includes(feature.key) ? 'text-text-secondary' : 'text-text-muted'
            }`}
            title={
              ADMIN_ONLY_FEATURE_KEYS.includes(feature.key)
                ? `${feature.label} is always admins-only`
                : `Only admins can open ${feature.label}`
            }
          >
            <LockIcon />
            <Toggle
              checked={adminOnly.includes(feature.key)}
              disabled={ADMIN_ONLY_FEATURE_KEYS.includes(feature.key)}
              onChange={on => setToolAdminOnly(feature.key, on)}
              aria-label={`Restrict ${feature.label} to admins`}
            />
          </span>
          {/* Remove — takes the tool's pages and its node types with it, so it
              asks first. Core tools can't be removed, but they still hold the
              slot so every row's toggle lines up. */}
          {isCore ? (
            <span className="h-7 w-7 shrink-0" />
          ) : (
            <button
              type="button"
              data-no-drag
              onClick={() => setConfirmRemoveKey(confirmRemoveKey === feature.key ? null : feature.key)}
              aria-expanded={confirmRemoveKey === feature.key}
              aria-label={`Remove ${feature.label}`}
              title={`Remove ${feature.label}`}
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors ${
                confirmRemoveKey === feature.key
                  ? 'bg-red-500/15 text-red-500'
                  : 'text-text-muted hover:bg-red-500/10 hover:text-red-500'
              }`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {confirmRemoveKey === feature.key && (
          <div data-no-drag className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
            <span className="min-w-0 text-sm text-text-secondary">
              Remove {feature.label}?
              {typeNamesPhrase(feature.key)
                ? ` Its pages and ${typeNamesPhrase(feature.key)} disappear for everyone. Nothing is deleted — add it back any time.`
                : ' Its pages disappear for everyone. Nothing is deleted — add it back any time.'}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemoveKey(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => removeTool(feature.key)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Remove
              </button>
            </span>
          </div>
        )}

      </div>
    );
  };

  return (
    <div ref={flipRoot} className="w-full space-y-8">
      {/* The sidebar rail, in order. Drag a row to reorder it or to move it
          into the More section below, lock to restrict it to admins, × to
          remove it. */}
      {/* No heading here — the console shell already titles the pane "Tools".
          Only the Add tool button sits above the list. */}
      <section>
        {/* Always shown, even with nothing left to add — the picker says so
            itself rather than the button vanishing. */}
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => { setPickerQuery(''); setPickerOpen(true); }}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-green px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon />
            Add tool
          </button>
        </div>
        {/* -mt-3 cancels the first row's top padding so the gap above the list
            matches every other section, while the rows themselves stay evenly
            padded. */}
        <div className="-mt-3 divide-y divide-border-subtle">
        {railKeys.length === 0 && (
          <p className="py-3 text-sm text-text-muted">
            Every tool is in More. Drag one back up here to give it a sidebar row.
          </p>
        )}
        {railKeys.map(renderToolRow)}
        </div>
      </section>

      {/* The More popup, as its own section — the drop target is the whole
          block, so dragging a row into it tucks the tool away (and dragging one
          out puts it back on the rail). */}
      <SettingsSection
        title={
          <span className="flex items-center gap-1.5">
            <MoreDotsIcon />
            More
          </span>
        }
      >
        <div
          data-flip-key={`row:${MORE_DIVIDER}`}
          className={`divide-y divide-border-subtle rounded-xl border border-dashed px-3 transition-colors ${
            draggingKey ? 'border-brand-green/60 bg-brand-green/5' : 'border-border-default'
          }`}
        >
          {moreKeys.length === 0 ? (
            <p className="py-3 text-center text-sm text-text-muted">
              Drag a tool here to tuck it into the More popup.
            </p>
          ) : (
            moreKeys.map(renderToolRow)
          )}
        </div>
      </SettingsSection>

      {/* The catalogue of everything not yet added. Each row names the node types
          the tool brings with it — that's the half of an add that isn't visible
          in the sidebar. Adding leaves the picker open so several tools can go
          in at once; it closes itself once nothing is left to add. */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add a tool"
        size="sm"
        panelClassName="bg-surface-1 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]"
      >
        <div className="space-y-3 p-4">
          {availableFeatures.length > 0 && (
            <SearchInput
              value={pickerQuery}
              onChange={setPickerQuery}
              placeholder="Search tools…"
              autoFocus
            />
          )}
          {availableFeatures.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              Every tool is already added.
            </p>
          ) : pickerResults.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">No tools match “{pickerQuery}”.</p>
          ) : (
            <ul className="space-y-1">
              {pickerResults.map(feature => (
                <li key={feature.key}>
                  <button
                    type="button"
                    onClick={() => {
                      addTool(feature.key);
                      if (availableFeatures.length <= 1) setPickerOpen(false);
                    }}
                    className="flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="shrink-0 text-text-secondary">
                      {feature.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-text-primary">{feature.label}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">{feature.description}</span>
                      {typeNamesPhrase(feature.key) && (
                        <span className="mt-1 block text-xs text-text-muted">
                          Adds {typeNamesPhrase(feature.key)}.
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 shrink-0 text-text-muted">
                      <PlusIcon />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}
