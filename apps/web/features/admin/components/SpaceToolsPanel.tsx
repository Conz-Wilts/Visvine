'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LockIcon, Trash2Icon } from '@/features/shared/icons';
import { Space, SpaceFeatureConfig } from '@/lib/types';
import { ADMIN_ONLY_FEATURE_KEYS, FEATURES, NAV_HIDDEN_FEATURE_KEYS, adminOnlyFeatureKeys, featureNodeTypeNames, isFeatureEnabled, isToolRailKey, moreFeatureKeys, sortFeatureKeys, toolFeatures } from '@/features/shared/lib/features';
import { ConfirmDialog, Modal, SearchInput, SettingsSection } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useConsoleAutosave } from '@/features/admin/components/console/ConsoleSaveContext';
import { fetchJsonBody } from '@/lib/fetchJson';
import { deleteAuthoredTool, uninstallTool } from '@/features/tools/lib/client';
import { motion } from '@visvine/tokens';

interface Props {
  space: Space;
  onSaved: (updated: Partial<Space>) => void;
}

const iconProps = {
  className: 'h-5 w-5',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  viewBox: '0 0 24 24',
} as const;

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

/**
 * The admins-only lock on a tool's row. Unlabelled: the padlock is the label,
 * and the row is already a heading — a "Who can open this" caption on every one
 * of a dozen rows says the same thing a dozen times.
 */
function LockToggle({ label, locked, always, onChange }: {
  label: string;
  locked: boolean;
  always: boolean;
  onChange: (locked: boolean) => void;
}) {
  const title = always
    ? `${label} is always admins-only`
    : locked
      ? `${label} is admins-only — click to open it to everyone`
      : `${label} is open to everyone — click to restrict it to admins`;
  return (
    <span
      data-no-drag
      title={title}
      className={`flex shrink-0 items-center gap-1.5 ${
        locked || always ? 'text-fg-secondary' : 'text-fg-muted'
      }`}
    >
      <LockIcon className="h-3.5 w-3.5" />
      <Toggle
        checked={locked || always}
        disabled={always}
        onChange={onChange}
        aria-label={`Restrict ${label} to admins`}
      />
    </span>
  );
}

export default function SpaceToolsPanel({ space, onSaved }: Props) {
  const savedConfig = (space.featureConfig ?? {}) as SpaceFeatureConfig;

  // An installed Tool is a row here exactly like a built-in: same drag, same
  // More toggle, same commit path. Its bin really does uninstall (and, for a
  // Tool authored in this space, deletes the working copy too) — the row goes
  // through the Tools REST surface rather than this panel's settings PUT.
  const toolRows = useMemo(() => toolFeatures(space.installedTools), [space.installedTools]);
  const allFeatures = useMemo(() => [...FEATURES, ...toolRows], [toolRows]);
  const featureOf = (key: string) => allFeatures.find(f => f.key === key);

  /**
   * `tool:<slug>` keys the space has placed that this panel has no row for — a
   * Tool installed since this space object was fetched, or one another admin
   * uninstalled while the panel was open.
   *
   * The settings PUT writes `order` and `more` whole (only `enabled` merges key
   * by key), so a key this panel forgets is a Tool unplaced for everyone. These
   * ride through every save untouched rather than being rebuilt from a list that
   * may be a moment behind the database.
   */
  const carried = useMemo(() => {
    const known = new Set(allFeatures.map(f => f.key));
    const seen = new Set<string>();
    return [...(savedConfig.order ?? []), ...(savedConfig.more ?? [])].filter(key => {
      if (!isToolRailKey(key) || known.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // savedConfig is re-read from the stored space, which is what re-keys this panel.
  }, [allFeatures, savedConfig.order, savedConfig.more]);
  const carriedRef = useRef(carried);
  carriedRef.current = carried;
  const carriedMore = carried.filter(key => (savedConfig.more ?? []).includes(key));
  const carriedMoreRef = useRef(carriedMore);
  carriedMoreRef.current = carriedMore;

  // Which tools the space has added, seeded from its current config. Adds
  // and removes persist immediately; a removed tool takes its node types with it
  // (isNodeTypeEnabled reads the same `enabled` map). An installed Tool's key is
  // seeded too — installing writes it `true`, and this panel has no way to write
  // it `false` — so that a row hidden in the config reads as hidden HERE as well
  // as in the sidebar, rather than the two disagreeing.
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      allFeatures
        .filter(f => !f.core)
        .map(f => [f.key, isFeatureEnabled(savedConfig, f.key)])
    )
  );
  // Tools only admins can open. A tool's row says everything about that tool —
  // whether the space has it, where it sits, and who may open it — rather than
  // splitting the last one onto a permissions screen the other two aren't on.
  const [adminOnly, setAdminOnly] = useState<string[]>(() => adminOnlyFeatureKeys(savedConfig));
  // Nav-hidden features (Messages and Events in the top bar, Context under the
  // Directory) are never a toggle and never ordered here — see NAV_HIDDEN_FEATURE_KEYS.
  const [order, setOrder] = useState<string[]>(() =>
    sortFeatureKeys(savedConfig, [
      ...allFeatures.filter(f => !NAV_HIDDEN_FEATURE_KEYS.includes(f.key)).map(f => f.key),
      ...carried,
    ])
  );
  // Keys tucked into the sidebar's "More" popup. Membership is positional in the
  // UI — a row below the More divider is in More — but stored as its own list.
  const [more, setMore] = useState<string[]>(() => moreFeatureKeys(savedConfig));
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  // The row whose Remove button is awaiting confirmation — a centred
  // ConfirmDialog, not an inline panel, so the question can't be missed under
  // a long list. Removing hides a surface and its node types space-wide (or,
  // for an installed Tool, really uninstalls/deletes), so it asks first.
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
  // The "Add tool" picker. Tools a space hasn't added live in here rather
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
        { duration: moved ? 420 : 320, easing: motion.easeCss.enter },
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
  // A drag across the More divider moves the row into the other list, and React
  // remounts it there — so the row is looked up by key on every move, and the
  // move/up listeners live on the window rather than on an element that may be
  // detached mid-drag (whose pointerup would never arrive, leaving it lifted).
  const dragState = useRef<{ key: string; grabOffset: number; initialSequence: string[] } | null>(null);
  const rowEl = (key: string) =>
    flipRoot.current?.querySelector<HTMLElement>(`[data-flip-key="row:${key}"]`) ?? null;
  const dragTranslate = useRef(0);
  const orderRef = useRef(order);
  orderRef.current = order;
  const moreRef = useRef(more);
  moreRef.current = more;

  // `order` carries every tool, added or not; only added ones have a row. Keys
  // with no feature behind them at all (see `carried`) are in neither list —
  // they are re-appended on every save instead of being rendered.
  const isAdded = (key: string) =>
    FEATURES.find(f => f.key === key)?.core === true || enabled[key] !== false;
  const addedKeys = order.filter(key => featureOf(key) && isAdded(key));
  const removedKeys = order.filter(key => featureOf(key) && !isAdded(key));
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
  const pressState = useRef<{ key: string; startY: number; grabOffset: number } | null>(null);

  const pressRow = (e: React.PointerEvent<HTMLDivElement>, key: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    pressState.current = {
      key,
      startY: e.clientY,
      grabOffset: e.clientY - e.currentTarget.getBoundingClientRect().top,
    };
  };

  const pressMove = (e: React.PointerEvent<HTMLElement>) => {
    const press = pressState.current;
    if (!press || dragState.current) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      pressState.current = null;
      return;
    }
    if (Math.abs(e.clientY - press.startY) < DRAG_THRESHOLD) return;
    dragState.current = {
      key: press.key,
      grabOffset: press.grabOffset,
      initialSequence: sequenceRef.current,
    };
    dragTranslate.current = 0;
    setDraggingKey(press.key);
    // The drag lasts exactly as long as the button is held. A release the
    // window never hears (let go outside it, or focus lost) shows up as a move
    // with no button down, or as a blur — either ends it.
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse' && ev.buttons === 0) onUp();
      else dragHandlers.current.moveDrag(ev);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      dragHandlers.current.endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    moveDrag(e);
  };

  const moveDrag = (e: { clientY: number }) => {
    const drag = dragState.current;
    if (!drag) return;
    const el = rowEl(drag.key);
    if (!el) return;
    // The row's layout slot shifts when the list reorders under it, so derive
    // it fresh each move: on-screen top minus the transform we applied. A
    // remounted row carries no transform yet, so read what it actually has.
    const applied = el.style.transform ? dragTranslate.current : 0;
    const baseTop = el.getBoundingClientRect().top - applied;
    const translate = e.clientY - drag.grabOffset - baseTop;
    dragTranslate.current = translate;
    el.style.transform = `translateY(${translate}px) scale(1.02)`;

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
    const el = rowEl(drag.key);
    if (el) el.style.transform = '';
    if (el && Math.abs(translate) > 1) {
      // Settle the card from wherever the cursor left it into its new slot.
      el.animate(
        [{ transform: `translateY(${translate}px) scale(1.02)` }, { transform: 'translateY(0) scale(1)' }],
        { duration: 280, easing: motion.easeCss.enter },
      );
    }
    setDraggingKey(null);
    // Drag moves only touched local state; persist once, when the row is dropped.
    if (sequenceRef.current.join() !== drag.initialSequence.join()) {
      commit(enabled, adminOnly, orderRef.current, moreRef.current);
    }
  };
  // The window listeners outlive a render; they call the latest closures.
  const dragHandlers = useRef({ moveDrag, endDrag });
  dragHandlers.current = { moveDrag, endDrag };

  const { queue } = useConsoleAutosave(async (patch) => {
    const data = await fetchJsonBody<{ space: Partial<Space> }>(`/api/spaces/${space.id}/settings`, 'PUT', patch);
    onSaved(data.space);
  });

  // The PUT merges these keys over the stored config, so a save must carry a
  // COMPLETE array for each key it sends — but needn't carry keys it doesn't own.
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

  /** The `order` a save carries: the placed rows, the removed ones, and then
   *  every key this panel has no row for (see `carried`). */
  const composeOrder = (placed: string[], removed: string[]) =>
    [...placed, ...removed, ...carriedRef.current];

  /**
   * Split a dragged sequence back into order + More membership. `persist` is
   * false for the live moves inside a drag — endDrag saves once on drop.
   */
  const applySequence = (seq: string[], persist: boolean) => {
    const cut = seq.indexOf(MORE_DIVIDER);
    const dragged = seq.slice(cut + 1);
    const nextMore = [...dragged, ...carriedMoreRef.current];
    const nextOrder = composeOrder([...seq.slice(0, cut), ...dragged], removedRef.current);
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
      composeOrder([...railKeys, key, ...moreKeys], removedKeys.filter(k => k !== key)),
      more,
    );
  };

  // The bin on an INSTALLED Tool's row. Unlike removeTool below, this is not a
  // config edit: it uninstalls through the Tools REST surface (rail key, install
  // row and stored state in one transaction server-side), and — when the Tool
  // was authored in this space — deletes the working copy with it, which is the
  // whole "remove a created tool" ask. Published marketplace versions stay.
  const [removeInstallError, setRemoveInstallError] = useState<string | null>(null);

  const installOf = (key: string) =>
    (space.installedTools ?? []).find(t => `tool:${t.slug}` === key) ?? null;

  /** `<name>` when this space authored the Tool (its key is `<spaceId>/<name>`), else null. */
  const authoredNameOf = (toolKey: string) =>
    toolKey.startsWith(`${space.id}/`) ? toolKey.slice(space.id.length + 1) : null;

  const removeInstalledTool = async (key: string) => {
    const dto = installOf(key);
    if (!dto) return;
    setRemoveInstallError(null);
    try {
      const authoredName = authoredNameOf(dto.key);
      if (authoredName) {
        await deleteAuthoredTool(space.id, authoredName);
      } else {
        await uninstallTool(space.id, dto.id);
      }
      setConfirmRemoveKey(null);
      // Strip the row locally so it disappears now; onSaved also triggers a
      // refetch that re-syncs installedTools and the stored config.
      const strip = (list?: string[]) => (list ?? []).filter(k => k !== key);
      const cfg = (space.featureConfig ?? {}) as SpaceFeatureConfig;
      const nextEnabled = { ...(cfg.enabled ?? {}) };
      delete nextEnabled[key];
      onSaved({
        installedTools: (space.installedTools ?? []).filter(t => t.slug !== dto.slug),
        featureConfig: {
          ...cfg,
          enabled: nextEnabled,
          order: strip(cfg.order),
          more: strip(cfg.more),
          adminOnly: strip(cfg.adminOnly),
        },
      });
    } catch (err) {
      setRemoveInstallError(err instanceof Error ? err.message : 'The remove did not go through.');
    }
  };

  /** Remove a tool: its nav row, its pages and its node types all go with it. */
  const removeTool = (key: string) => {
    setConfirmRemoveKey(null);
    commit(
      { ...enabled, [key]: false },
      // Admins-only is placement on a row that no longer exists — drop it too.
      adminOnly.filter(k => k !== key),
      composeOrder(addedKeys.filter(k => k !== key), [key, ...removedKeys]),
      // A removed tool has no sidebar row left to tuck away.
      more.filter(k => k !== key),
    );
  };

  // Tools with no sidebar row of their own — `tools` today (see
  // NAV_HIDDEN_FEATURE_KEYS). They're still ordinary switches in `enabled` —
  // nothing else can ever turn `tools` on for a space otherwise — but there's no
  // rail/More position to drag them into, so they get a plain toggle in their
  // own list instead of a row in `order`, and only surface in the picker while
  // off (mirroring how a removed built-in only shows there too).
  const unplaceableFeatures = allFeatures.filter(
    f => !f.core && NAV_HIDDEN_FEATURE_KEYS.includes(f.key),
  );
  const isUnplaceableEnabled = (key: string) => enabled[key] !== false;
  const enabledUnplaceable = unplaceableFeatures.filter(f => isUnplaceableEnabled(f.key));
  const disabledUnplaceable = unplaceableFeatures.filter(f => !isUnplaceableEnabled(f.key));

  /** Flip a no-row tool on or off. Only `enabled` changes — `order`/`more` never see it. */
  const toggleUnplaceable = (key: string, on: boolean) => {
    commit({ ...enabled, [key]: on }, adminOnly, order, more);
  };

  /** Lock a tool to admins, or open it to the space again. */
  const setToolAdminOnly = (key: string, locked: boolean) => {
    commit(
      enabled,
      locked ? [...adminOnly, key] : adminOnly.filter(k => k !== key),
      order,
      more,
    );
  };

  const availableFeatures = [...removedKeys.map(key => featureOf(key)!), ...disabledUnplaceable];
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
    const feature = featureOf(item)!;
    // Core tools can't be removed. An installed Tool CAN — its bin uninstalls
    // (and deletes an authored working copy) via removeInstalledTool; only a
    // `tool:` key with no install row behind it has nothing to act on.
    const install = isToolRailKey(feature.key) ? installOf(feature.key) : null;
    // A Tool shared down from the parent space is not this space's to remove
    // either — it goes when the parent stops sharing it (lib/tools/share.ts).
    const isFixed = feature.core === true || (isToolRailKey(feature.key) && (!install || !!install.sharedFrom));
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
        onPointerMove={pressMove}
        onPointerUp={() => { if (!dragState.current) pressState.current = null; }}
        onPointerCancel={() => { if (!dragState.current) pressState.current = null; }}
        // Even padding on every row — trimming the first and last would leave
        // the dividers unevenly spaced.
        className={`cursor-grab select-none py-4 ${
          isDragging
            ? 'relative z-10 -mx-3 cursor-grabbing rounded-xl !border-transparent bg-surface px-3 shadow-float ring-1 ring-line-subtle'
            : ''
        }`}
      >
        <div className="flex items-center gap-3.5">
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
            className="shrink-0 rounded text-fg-muted transition-colors hover:text-fg-secondary focus-visible:text-fg-secondary"
          >
            <GripIcon />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <span className="shrink-0 text-fg-secondary">
              {feature.icon}
            </span>
            {/* Sized like a Types row's name: this list IS the page, so a tool
                reads as a heading rather than as a settings line. */}
            <span className="min-w-0 truncate text-base font-semibold text-fg">
              {feature.label}
            </span>
          </div>
          {/* Who may open it. Off is the default and says nothing; on, the tool
              leaves every member's sidebar and refuses them the page. A few
              tools are admins-only by nature and show the lock held shut. */}
          <LockToggle
            label={feature.label}
            locked={adminOnly.includes(feature.key)}
            always={ADMIN_ONLY_FEATURE_KEYS.includes(feature.key)}
            onChange={locked => setToolAdminOnly(feature.key, locked)}
          />
          {/* Remove — takes the tool's pages and its node types with it, so it
              asks first. */}
          {isFixed ? (
            <span className="h-7 w-7 shrink-0" />
          ) : (
            <button
              type="button"
              data-no-drag
              onClick={() => { setRemoveInstallError(null); setConfirmRemoveKey(feature.key); }}
              aria-label={`Remove ${feature.label}`}
              title={`Remove ${feature.label}`}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-danger-bright/10 hover:text-danger-bright"
            >
              <Trash2Icon className="h-4 w-4" />
            </button>
          )}
        </div>

      </div>
    );
  };

  // What the centred confirm asks depends on the row: a built-in is only
  // hidden (config edit), an installed Tool is really uninstalled, and one
  // authored here is deleted outright.
  const confirmFeature = confirmRemoveKey ? featureOf(confirmRemoveKey) : undefined;
  const confirmInstall = confirmRemoveKey ? installOf(confirmRemoveKey) : null;
  const confirmAuthoredName = confirmInstall ? authoredNameOf(confirmInstall.key) : null;

  return (
    <div ref={flipRoot} className="w-full space-y-8">
      {/* The sidebar rail, in order. Drag a row to reorder it or to move it
          into the More section below, lock to restrict it to admins, × to
          remove it.

          Sections are separated by spacing alone, except More, which keeps
          its hairline so the rail and the popup read as two lists. Every list sits -mt-3
          under its heading so the first row's top padding doesn't double the
          gap, which keeps heading→row spacing identical in every section. */}
      <SettingsSection
        flush
        large
        title="Active tools"
        action={
          // Always shown, even with nothing left to add — the picker says so
          // itself rather than the button vanishing.
          <button
            type="button"
            onClick={() => { setPickerQuery(''); setPickerOpen(true); }}
            className="-my-1.5 inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon />
            Add tool
          </button>
        }
      >
        <div className="-mt-3 divide-y divide-line-subtle">
        {railKeys.length === 0 && (
          <p className="py-3 text-sm text-fg-muted">
            Every tool is in More. Drag one back up here to give it a sidebar row.
          </p>
        )}
        {railKeys.map(renderToolRow)}
        </div>
      </SettingsSection>

      {/* The More popup, as its own section — the drop target is the whole
          block, so dragging a row into it tucks the tool away (and dragging one
          out puts it back on the rail). Its outline only appears mid-drag, as
          the drop cue. */}
      <SettingsSection
        large
        title={
          <span className="flex items-center gap-1.5">
            <MoreDotsIcon />
            More
          </span>
        }
      >
        <div
          data-flip-key={`row:${MORE_DIVIDER}`}
          // min-h keeps an empty More a drop target now that it has no hint text.
          className={`-mt-3 min-h-14 divide-y divide-line-subtle rounded-xl ring-1 transition-colors ${
            draggingKey ? 'ring-accent/60 bg-accent/5' : 'ring-transparent'
          }`}
        >
          {moreKeys.map(renderToolRow)}
        </div>
      </SettingsSection>

      {/* Tools reached elsewhere in the app (the marketplace icon, an install's
          own rail row) rather than a "Tools" row here — see NAV_HIDDEN_FEATURE_KEYS.
          Still an on/off switch like any other tool, just not a draggable one. */}
      {unplaceableFeatures.length > 0 && (
        <SettingsSection
          flush
          title="No sidebar row"
          description="Reached elsewhere in the app, so there's nothing to reorder — just on or off."
        >
          <div className="-mt-3 divide-y divide-line-subtle">
            {enabledUnplaceable.length === 0 ? (
              <p className="py-3 text-sm text-fg-muted">
                Nothing on. Add one from the picker above.
              </p>
            ) : (
              enabledUnplaceable.map(feature => (
                <div key={feature.key} className="flex items-center gap-3.5 py-4">
                  <span className="shrink-0 text-fg-secondary">{feature.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold text-fg">{feature.label}</div>
                    <div className="truncate text-sm text-fg-muted">{feature.description}</div>
                  </div>
                  <Toggle
                    checked
                    onChange={on => toggleUnplaceable(feature.key, on)}
                    aria-label={`Turn off ${feature.label}`}
                  />
                </div>
              ))
            )}
          </div>
        </SettingsSection>
      )}

      {/* The catalogue of everything not yet added. Each row names the node types
          the tool brings with it — that's the half of an add that isn't visible
          in the sidebar. Adding leaves the picker open so several tools can go
          in at once; it closes itself once nothing is left to add. */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add tool"
        size="sm"
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
            <p className="py-6 text-center text-sm text-fg-muted">
              Every tool is already added.
            </p>
          ) : pickerResults.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">No tools match “{pickerQuery}”.</p>
          ) : (
            <ul className="space-y-1">
              {pickerResults.map(feature => (
                <li key={feature.key}>
                  <button
                    type="button"
                    onClick={() => {
                      if (unplaceableFeatures.some(f => f.key === feature.key)) {
                        toggleUnplaceable(feature.key, true);
                      } else {
                        addTool(feature.key);
                      }
                      if (availableFeatures.length <= 1) setPickerOpen(false);
                    }}
                    className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-surface-subtle"
                  >
                    <span className="shrink-0 text-fg-secondary">
                      {feature.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">{feature.label}</span>
                      <span className="mt-0.5 block text-xs text-fg-muted">{feature.description}</span>
                    </span>
                    <span className="mt-0.5 shrink-0 text-fg-muted">
                      <PlusIcon />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmRemoveKey !== null && confirmFeature !== undefined}
        title={
          confirmInstall
            ? confirmAuthoredName
              ? `Delete ${confirmFeature?.label}?`
              : `Uninstall ${confirmFeature?.label}?`
            : `Remove ${confirmFeature?.label}?`
        }
        body={
          confirmInstall ? (
            confirmAuthoredName ? (
              <>
                Its working copy, <code className="font-mono text-[13px]">tools/{confirmAuthoredName}</code>, is
                deleted. Published versions stay.
              </>
            ) : (
              <>Anything it stored goes with it.</>
            )
          ) : confirmFeature && typeNamesPhrase(confirmFeature.key) ? (
            <>Its pages and {typeNamesPhrase(confirmFeature.key)} are hidden for everyone. Nothing is deleted.</>
          ) : (
            <>Its pages are hidden for everyone. Nothing is deleted.</>
          )
        }
        confirmLabel={confirmInstall ? (confirmAuthoredName ? 'Delete tool' : 'Uninstall') : 'Remove'}
        destructive
        error={removeInstallError}
        onConfirm={async () => {
          if (!confirmRemoveKey) return;
          if (confirmInstall) {
            await removeInstalledTool(confirmRemoveKey);
          } else {
            removeTool(confirmRemoveKey);
          }
        }}
        onClose={() => { setConfirmRemoveKey(null); setRemoveInstallError(null); }}
      />
    </div>
  );
}
