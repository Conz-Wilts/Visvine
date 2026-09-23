'use client';

// The one tab set for everything under /directory — rendered INTO the shell's
// top band (ShellTopBar's shellTabsHost/shellTrailHost) so the band, the tabs
// and the page actions are one row rather than two stacked bars. The component
// itself stays mounted in the persistent pane shell (directory/layout.tsx →
// PaneShell), so navigating between notes, profiles and the Directory index
// re-labels the portalled row instead of mounting a new one; what it shows
// comes from the pages via PaneShellContext. What remains in the pane is the
// sticky strip + the attached toolbar tray, which belong over the content.

import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { WaypointsIcon } from '@/features/shared/icons';
import { useTabBarSlot } from '@/features/shared/contexts/TabBarSlotContext';
import {
  CONNECTIONS_RAIL_W,
  useConnectionsRailVisible,
  useContextPanel,
  useDockVisuallyOpen,
} from '@/features/shared/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W, useContextTreeVisible } from '@/features/notes/components/ContextSidebar';
import { applyTabIndicator, publishTabIndicator, useTabIndicatorHandoff } from '@/components/ui/tabIndicatorHandoff';
import { TAB_MOTION, TAB_MOTION_EASE, TAB_SET_MOTION_MS } from '@/components/ui/tabMotion';
import { usePaneChromeState, type PaneChromeState, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import PaneTopScrollbarMask from './PaneTopScrollbarMask';
import { SHELL_PANE_TOP } from '@/features/shared/contexts/ThemeContext';
import { useShellBand } from '@/features/desktop/lib/chrome';
import { motion as motionTokens } from '@visvine/tokens';

/** Height the attached region reserves: the floating toolbar card (44px), the
 *  gap detaching it from the nav line, and room below for its shadow — the
 *  region clips (overflow-hidden), so anything unaccounted for is cut off. */
export const TRAY_ROW_H = 72;

/** Top inset for anything docking beside the pane (the notes tree). The tab
 *  row lives in the shell band now, so nothing of the pane's chrome stands
 *  above the tree — it starts at the content line, the same SHELL_PANE_TOP
 *  the rail's first row sits on. */
export const dockTopInsetFor = () => SHELL_PANE_TOP;

/** Handoff key for the underline (see tabIndicatorHandoff). This bar never
 *  remounts within /directory, so it only fires crossing into or out of the
 *  shell, or when a bar reappears after tabs were null. */
export const HANDOFF_KEY = 'pane-top';

/** Bleed + stacking for the bar. The raised state stops one pixel short of the
 *  rail's seam border so the seam stays visible; the default full bleed sits
 *  under the aside. Raised while the docked tree is visible (including the
 *  slide-shut window) so a closing column can't cross the bar. Computed from
 *  actual dock visibility, not registered by pages — a page's tab state flips
 *  before the dock finishes closing. */
export function useDockEdgeClass(): string {
  return useDockVisuallyOpen() ? '-ml-[23px] z-[45]' : '-ml-6 z-20';
}

/** Cross-page label identity for the FLIP: the eye tracks the word, so match on
 *  label text with any trailing count stripped — "Connections (5)" →
 *  "Connections (12)" is a move, not a swap. Ids would need coordination across
 *  pages; words don't. */
const labelMatchKey = (label: string) => label.replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase();

interface LabelRect {
  left: number;
  width: number;
  label: string;
}

export default function PaneTabBar() {
  const { chrome, select } = usePaneChromeState();
  const pathname = usePathname();
  // Unmounting rather than hiding is deliberate: it drops the armed/indicator
  // state, so a bar coming back mounts through the same first-frame path as a
  // shell entry.
  if (!chrome || !chrome.tabs) return null;
  return <PaneTabBarInner chrome={chrome} tabs={chrome.tabs} select={select} live={pathname === chrome.pathname} />;
}

function PaneTabBarInner({
  chrome,
  tabs,
  select,
  live,
}: {
  chrome: PaneChromeState;
  tabs: PaneTabItem[];
  select: (id: string) => void;
  /** False in the one-commit gap where the chrome still belongs to the page
   *  being navigated away from — clicks must not fire its dead onSelect. */
  live: boolean;
}) {
  const { activeId, attachedOpen } = chrome;
  const edgeClass = useDockEdgeClass();
  const { setHost } = useTabBarSlot();
  // The tray centres over the note column, not the pane: the tree column
  // takes the left of a note surface, so the attached region insets by its
  // width. The connections rail narrows the column from the right the same
  // way, so the tray insets by its width too — otherwise the toolbar stays
  // centred on the full card while the text it acts on slides left. Both only
  // exist at a breakpoint inline padding can't see, so each is read in JS.
  const { connectionsOpen, setConnectionsOpen, setTabTrailHost, shellTabsHost, shellTrailHost } = useContextPanel();
  useShellBand(!!shellTabsHost);
  const surfaceKind = chrome.surface?.kind;
  const showConnections = surfaceKind === 'note' || surfaceKind === 'entity';
  const rawOn =
    chrome.rawToggle === 'on' ||
    ((chrome.surface?.kind === 'note' || chrome.surface?.kind === 'entity') &&
      chrome.surface.mode === 'raw');
  const trayInset = useContextTreeVisible() && !!surfaceKind ? CONTEXT_PANEL_W : 0;
  const trayInsetRight = useConnectionsRailVisible() ? CONNECTIONS_RAIL_W : 0;
  // The Connections rail toggle rides the bar's right edge whenever a note or
  // entity surface is up — bar-level chrome for a bar-level panel, so it never
  // jumps around with the editor toolbar. Hidden below xl with the rail itself.

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  // Transitions arm only after the bar's first frame is on screen, so a mount
  // mid-navigation reads as one continuous bar instead of an entrance
  // animation. Once armed, real tab changes animate as designed.
  const [armed, setArmed] = useState(false);
  const motion = armed ? `transition-all ${TAB_MOTION}` : '';

  // The underline rect of the pane-top bar this one replaced when crossing in
  // from another shell, claimed once at mount. Null otherwise.
  const { handoff, firstMeasure } = useTabIndicatorHandoff(HANDOFF_KEY);

  const tabsKey = tabs.map((t) => `${t.id} ${t.label}`).join('|');

  // ── Label FLIP on in-place tab-set changes ─────────────────────────────────
  // A note→profile move arrives as a `tabs` prop change: surviving words slide
  // from their old x, new words fade in, removed words fade out as absolutely
  // positioned ghosts. The previous commit's settled rects live in a ref,
  // updated at the end of every measure pass — the "First" of FLIP.
  const prevRectsRef = useRef<Map<string, LabelRect>>(new Map());
  // Starts as the mount key, not '': the first measure pass must cache rects
  // without flagging a change.
  const prevTabsKeyRef = useRef(tabsKey);
  const [ghosts, setGhosts] = useState<LabelRect[]>([]);
  // True while a tab-set change's slower FLIP is playing — the underline reads
  // the flag so it travels with the sliding word instead of racing ahead of it.
  const [slowSet, setSlowSet] = useState(false);
  useEffect(() => {
    if (!slowSet) return;
    const id = setTimeout(() => setSlowSet(false), TAB_SET_MOTION_MS + 50);
    return () => clearTimeout(id);
  }, [slowSet]);

  useLayoutEffect(() => {
    if (!ghosts.length) return;
    // Purge after the exit animation (tabbar-label-exit holds opacity 0 via
    // `forwards`, so a late purge can't blink the word back).
    const id = setTimeout(() => setGhosts([]), TAB_SET_MOTION_MS + 50);
    return () => clearTimeout(id);
  }, [ghosts]);

  // Measure BEFORE paint, so the underline is already sitting under the active
  // tab on that first frame rather than being placed a frame later.
  useLayoutEffect(() => {
    // FLIP pass first, on every real tab-set change while armed (an unarmed bar
    // is mid-mount; the mount path owns that frame). WAAPI rather than React
    // state: fire-and-forget, self-cancelling when a faster navigation lands,
    // and StrictMode-safe.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tabsChanged = prevTabsKeyRef.current !== tabsKey;
    if (tabsChanged && armed && !reduced) {
      setSlowSet(true);
      const prevRects = prevRectsRef.current;
      const seen = new Set<string>();
      tabs.forEach((tab, i) => {
        const b = tabRefs.current[i];
        if (!b) return;
        const k = labelMatchKey(tab.label);
        seen.add(k);
        b.getAnimations().forEach((a) => a.cancel());
        const first = prevRects.get(k);
        if (first && Math.abs(first.left - b.offsetLeft) > 1) {
          // Surviving word: slide from where it stood. Translate only — scaled
          // text reads as smear, and cross-set width deltas are small.
          b.animate(
            [{ transform: `translateX(${first.left - b.offsetLeft}px)` }, { transform: 'none' }],
            { duration: TAB_SET_MOTION_MS, easing: TAB_MOTION_EASE },
          );
        } else if (!first) {
          // New word: fade in where it lands while its neighbours make room.
          b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TAB_SET_MOTION_MS, easing: 'ease-out' });
        }
      });
      const exiting = [...prevRects.values()].filter((r) => !seen.has(labelMatchKey(r.label)));
      if (exiting.length) setGhosts(exiting);
    }
    // Cache settled rects for the next change, on every pass, so reduced-motion
    // and unarmed changes keep the "First" positions honest.
    if (tabsChanged || prevRectsRef.current.size === 0) {
      const rects = new Map<string, LabelRect>();
      tabs.forEach((tab, i) => {
        const b = tabRefs.current[i];
        if (b) rects.set(labelMatchKey(tab.label), { left: b.offsetLeft, width: b.offsetWidth, label: tab.label });
      });
      prevRectsRef.current = rects;
      prevTabsKeyRef.current = tabsKey;
    }

    const idx = tabs.findIndex((t) => t.id === activeId);
    const btn = tabRefs.current[idx];
    if (!btn) return;
    const target = { left: btn.offsetLeft, width: btn.offsetWidth };
    publishTabIndicator(HANDOFF_KEY, target);
    return applyTabIndicator({
      handoff,
      target,
      firstMeasure,
      setIndicator: setIndicatorStyle,
      setArmed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, tabsKey, handoff]);

  // One frame later the measured position is painted, so turning transitions on
  // now can't retroactively animate it.
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const onSelect = (id: string) => {
    if (live) select(id);
  };

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % tabs.length;
      onSelect(tabs[next].id);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + tabs.length) % tabs.length;
      onSelect(tabs[prev].id);
      tabRefs.current[prev]?.focus();
    }
  }

  // The tab row, rendered into the shell band's tabs host — it sits beside the
  // panel switch, on the same line as the search and the account button.
  const tabsRow = (
    <div
      role="tablist"
      aria-label={chrome.ariaLabel ?? 'Sections'}
      // Scrolls when the words genuinely outgrow the band, but never shows a
      // bar for it: the underline is placed from rounded offsets and the
      // exiting-label ghosts sit where a word USED to be, so either can poke
      // past the edge by a subpixel or a whole tab after a set change — and a
      // scrollbar drawn for that is a bar under the tabs that never goes away.
      className="relative flex min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab, idx) => (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[idx] = el; }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={activeId === tab.id}
              aria-controls={`panel-${tab.id}`}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={`px-4 h-12 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none ${
                handoff ? 'tabbar-label-enter' : ''
              } text-fg`}
            >
              {tab.label}
            </button>
          ))}

          {/* Words that left the tab set, fading out where they stood while the
              survivors slide. */}
          {ghosts.map((g) => (
            <span
              key={g.label}
              aria-hidden
              className="tabbar-label-exit pointer-events-none absolute top-0 flex h-12 items-center px-4 text-sm font-medium whitespace-nowrap text-fg"
              style={{ left: g.left, animationDuration: `${TAB_SET_MOTION_MS}ms` }}
            >
              {g.label}
            </span>
          ))}

      {/* Animated green underline indicator. During a tab-set change it
          slows to the FLIP's duration so it travels with the sliding word. */}
      <div
        className={`absolute bottom-0 h-[3px] rounded-full bg-accent ${motion}`}
        style={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
          transitionDuration: slowSet ? `${TAB_SET_MOTION_MS}ms` : undefined,
        }}
      />
    </div>
  );

  // Trailing chrome, rendered into the band's trail host beside the account
  // button: same type, colour and height as a tab, and each toggle carries the
  // tabs' green underline while it is on so "on" reads the same way "selected"
  // does. Neither is wired to the sliding indicator — that belongs to the tab
  // set, and these are toggles, not extra tabs.
  const trailChrome = (
    <>
      {chrome.rawToggle && (
          <button
            type="button"
            onClick={() => onSelect('raw')}
            aria-pressed={rawOn}
            title="Edit the raw markdown"
            className="relative flex h-12 shrink-0 items-center gap-1.5 px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none text-fg"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Raw
            {rawOn && (
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-accent" />
            )}
          </button>
        )}
        {showConnections && (
          <button
            type="button"
            onClick={() => setConnectionsOpen(!connectionsOpen)}
            aria-pressed={connectionsOpen}
            title="What this note connects to"
            className={`relative hidden h-12 shrink-0 items-center gap-1.5 px-4 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none xl:flex text-fg`}
          >
            <WaypointsIcon className="h-4 w-4" />
            Connections
            {connectionsOpen && (
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-accent" />
            )}
          </button>
        )}
      {/* Share and anything else the open surface owns, portalled in by the
          panel (see ContextPanelContext.tabTrailHost). Zero-width when
          empty, so the row is unchanged on surfaces that fill nothing. */}
      <div ref={setTabTrailHost} className="flex shrink-0 items-center" />
    </>
  );

  return (
    <>
      {shellTabsHost && createPortal(tabsRow, shellTabsHost)}
      {shellTrailHost && createPortal(trailChrome, shellTrailHost)}

      {/* What stays in the pane: the painted clearance strip and the attached
          toolbar tray, pinned over the content. pointer-events-none here, auto
          on the pieces that are actually solid (the strip, and whatever the
          tray hosts) — left clickable the wrapper swallowed every click along
          its band, which is why the connections rail's close button did
          nothing. z-45 keeps a closing docked tree from crossing it.

          The clearance is a PAINTED strip inside the sticky box, not <main>'s
          top padding: "-mt-6" cancels that padding and "-top-6" cancels it
          again in the sticky offset (which resolves against <main>'s CONTENT
          box, not its padding box), so the box sits at the surface's top edge
          both at rest and pinned, and nothing scrolls through the space above
          the toolbar tray. */}
      <div className={`pointer-events-none sticky -top-6 -mt-6 ${edgeClass}`}>
        {/* Keeps the page scrollbar from running up beside the pinned strip.
            height={0} because the tab row itself is portalled into the shell
            band: the only thing pinned HERE is the 24px clearance below, so the
            mask covers that and nothing more. The default 48 would hang a white
            strip 48px down the surface's right edge past everything it serves. */}
        <PaneTopScrollbarMask height={0} />
        <div aria-hidden className="pointer-events-auto h-6 bg-glass" />

      {/* The attached region. Always mounted (a conditional mount would snap
          open with no transition) and animated 0fr↔1fr off the same tab state
          and timing as the indicator, so the pair moves as one gesture. The
          host reserves its full height from the first frame, so a tray that
          arrives late doesn't shift the content below. Only what the tray
          actually hosts takes clicks (see the wrapper's pointer-events note) —
          the transparent gutters either side of the centred toolbar must let
          them through to the rail and the note body underneath. */}
      <div
        className={`grid ${
          armed ? `transition-[grid-template-rows] ${TAB_MOTION}` : ''
        } motion-reduce:transition-none ${
          attachedOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {/* The host translates -100% in step with the row collapsing above
              it, on the same duration and curve, so the tray slides up behind
              the tab row and drops back down from under it. */}
          <div
            ref={setHost}
            className={`flex items-start justify-center [&>*]:pointer-events-auto motion-reduce:[transition:none!important] ${
              attachedOpen ? 'translate-y-0' : '-translate-y-full'
            }`}
            style={{
              height: TRAY_ROW_H,
              paddingLeft: trayInset || undefined,
              paddingRight: trayInsetRight || undefined,
              // `translate`, not `transform`: Tailwind v4's translate-y-*
              // utilities set the standalone CSS translate property.
              transition: armed
                ? `padding ${motionTokens.duration.base}ms ${motionTokens.easeCss.gentle}, translate ${motionTokens.duration.base}ms ${motionTokens.easeCss.standard}`
                : `padding ${motionTokens.duration.base}ms ${motionTokens.easeCss.gentle}`,
            }}
          />
        </div>
      </div>
      </div>
    </>
  );
}
