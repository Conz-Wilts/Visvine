'use client';

import { Children } from 'react';

/**
 * The chrome every tree in the app is drawn with: the full-bleed row band, the
 * guide lines that join a row to its parent, the folder glyph that doubles as
 * the expand control, and the height tween a branch opens with. Domain-free on
 * purpose — the Context sidebar and the Agents explorer share these so the two
 * trees are the same object in two places, not two lookalikes that drift.
 */

// VS Code-style row band: the hover/selection background runs the FULL panel
// width, square-edged, regardless of how deeply the row is nested. Rows sit
// inside per-level indent containers, so the depth offset isn't knowable in the
// row — instead the row box is pulled far to the left and given matching padding
// back, which leaves its content exactly where it was and lets the background
// (and the guide lines it covers) bleed out to the panel edge. The scroll
// container clips the overhang with overflow-x-hidden.
export const TREE_ROW_BLEED = '-ml-[999px] pl-[999px]';

// Indents that keep every level's line centred under its parent's glyph:
// glyph centre is 6 + 16/2 = 14px into the row content, plus the 12px guide
// column once the row itself is nested.
export const TREE_CHILD_INDENT = 'ml-[14px]';
export const TREE_NESTED_CHILD_INDENT = 'ml-[26px]';

// Tree guides. A nested row draws its OWN piece of the vertical line rather
// than inheriting one border from the indent container: the last child of a
// folder then ends the line at its own elbow instead of trailing past it, and
// the line sits above the row band so a hovered row does not paint over it.
// `mid` is a T (line through, tick out), `last` is a rounded elbow.
export type TreeGuideKind = 'mid' | 'last';

export function TreeGuide({ guide, active = false }: { guide: TreeGuideKind; active?: boolean }) {
  // A guide on the path to the open row is tinted, so the branch you are
  // inside reads as a trail from the root down rather than as identical grey
  // lines at every level.
  const line = active ? 'bg-brand-green/60' : 'bg-border-default/70';
  const edge = active ? 'border-brand-green/60' : 'border-border-default/70';
  return (
    <span data-tree-guide className="relative flex w-3 shrink-0 self-stretch" aria-hidden="true">
      {/* `tree-line` marks the vertical strokes so a spine being revealed can
          draw them downward (globals.css) rather than switching them on. */}
      {guide === 'last' ? (
        <span className={`tree-line absolute left-0 top-0 h-1/2 w-2.5 rounded-bl-[6px] border-b border-l ${edge}`} />
      ) : (
        <>
          <span className={`tree-line absolute left-0 top-0 h-full w-px ${line}`} />
          <span className={`absolute left-0 top-1/2 h-px w-2.5 ${line}`} />
        </>
      )}
    </span>
  );
}

/**
 * A SPINE: one unbroken stroke down a short list, dropping out of the swatch on
 * the row above, a tick into each row and a rounded corner into the last — it
 * ends where the list does rather than trailing past it.
 *
 * The difference from the guides above is what the two are FOR. A tree's rows
 * each draw their own segment because any of them may open a subtree of its
 * own; a spine is one flat set — a type's aliases, say — so it is drawn as one
 * line and can grow downward when the set is revealed.
 *
 * `ml-[14px]` puts it under the centre of the 20px glyph column on the row
 * above (4px of margin + half of 20), and the stem is the climb from that
 * glyph's bottom edge down to the row's own — 18px on a `py-4` list row, which
 * is the default. A tighter row (a menu's) needs its own: pass `stem` = half
 * the row's height minus half the glyph, or the stroke starts inside the glyph
 * instead of under it. Pass `animate` when the list is being revealed: the
 * stroke draws down and each row lands as it is reached.
 */
export function TreeSpine({ children, animate = false, stem: stemPx = 18 }: {
  children: React.ReactNode;
  animate?: boolean;
  /** Pixels from the branch's top up to the glyph it hangs from. */
  stem?: number;
}) {
  const rows = Children.toArray(children);
  const last = rows.pop();
  const count = rows.length + (last ? 1 : 0);
  // The stem is the short climb back to the swatch, so it draws first and the
  // run picks up where it stops; the run takes as long as the rows it passes.
  const runMs = spineDelay(Math.max(count - 1, 0)) + SPINE_ROW_MS;
  const stem = animate ? { animationDuration: `${SPINE_STEM_MS}ms` } : undefined;
  const run = animate
    ? { animationDuration: `${runMs}ms`, animationDelay: `${SPINE_STEM_MS}ms` }
    : undefined;
  const row = (i: number) =>
    animate ? { animationDelay: `${SPINE_STEM_MS + spineDelay(i)}ms` } : undefined;

  return (
    <div className={`relative ml-[14px] ${animate ? 'tree-spine-enter' : ''}`}>
      <span
        aria-hidden
        style={{ ...stem, top: -stemPx, height: stemPx }}
        className="tree-line pointer-events-none absolute left-0 w-px bg-border-default/70"
      />
      {rows.length > 0 && (
        <div className="relative">
          {/* Above the rows, so a row whose band bleeds out to the panel's
              edge (TREE_ROW_BLEED) is painted under the line rather than over it. */}
          <span
            aria-hidden
            style={run}
            className="tree-line pointer-events-none absolute inset-y-0 left-0 z-[1] w-px bg-border-default/70"
          />
          {rows.map((child, i) => (
            <div key={keyOf(child, i)} className="tree-spine-row" style={row(i)}>
              {child}
            </div>
          ))}
        </div>
      )}
      {last && (
        <div className="tree-spine-row" style={row(rows.length)}>
          {last}
        </div>
      )}
    </div>
  );
}

// The spine's timing, in one place: the stem draws, then the run travels past
// one row every STAGGER while each row lands under it. The stagger stops
// growing after a handful of rows so a long list never holds its tail off
// screen waiting its turn.
const SPINE_STEM_MS = 90;
const SPINE_STAGGER_MS = 40;
const SPINE_ROW_MS = 190;
// The step shortens after the fifth row rather than stopping: holding every
// later row on one delay animates the head of a long list and then drops the
// whole tail on a single frame, which reads as two different animations.
const SPINE_FULL_ROWS = 5;
const SPINE_TAIL_MS = 18;
const SPINE_TAIL_ROWS = 14;

/** How long after the stem a row lands, walking down the list. */
function spineDelay(i: number): number {
  return (
    Math.min(i, SPINE_FULL_ROWS) * SPINE_STAGGER_MS +
    Math.max(0, Math.min(i, SPINE_TAIL_ROWS) - SPINE_FULL_ROWS) * SPINE_TAIL_MS
  );
}

function keyOf(child: React.ReactNode, i: number): string {
  return typeof child === 'object' && child !== null && 'key' in child && child.key
    ? String(child.key)
    : String(i);
}

/**
 * A row's join to the spine: the tick off it, or the rounded corner that ends
 * it. `-my-2.5` cancels the row's own padding — align-self stretch fills the
 * CONTENT box, so without it the corner would start below the row's top edge,
 * exactly where the stroke above it ends, leaving a gap.
 */
export function TreeSpineJoin({ kind }: { kind: TreeGuideKind }) {
  return (
    <span className="relative -my-2.5 flex w-3 shrink-0 self-stretch" aria-hidden>
      {kind === 'last' ? (
        <span className="tree-line absolute left-0 top-0 h-1/2 w-3 rounded-bl-[6px] border-b border-l border-border-default/70" />
      ) : (
        <span className="absolute left-0 top-1/2 h-px w-3 bg-border-default/70" />
      )}
    </span>
  );
}

/**
 * The vertical line continuing a row's own guide down past its subtree. Without
 * it the parent level's line breaks every time a folder is expanded, leaving a
 * gap between the folder and its next sibling.
 */
export function TreeGuideRun({ active = false }: { active?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute bottom-0 left-0 top-0 w-px ${active ? 'bg-brand-green/60' : 'bg-border-default/70'}`}
    />
  );
}

/**
 * The stem an open folder's children hang from: it drops out of the folder
 * glyph rather than starting in mid-air below it. It begins just under the 16px
 * glyph's bottom edge (half the row + 8px + a hair of air) so it never draws
 * through the icon, and sits at the glyph's centre — exactly where
 * TREE_CHILD_INDENT puts the children's guides, so the two read as one line.
 */
export function TreeStem({ active = false }: { active?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute bottom-0 left-[14px] top-[calc(50%+10px)] w-px ${active ? 'bg-brand-green/60' : 'bg-border-default/70'}`}
    />
  );
}

/** The folder glyph — open vs shut IS the icon, so a tree row needs no chevron. */
export function TreeFolderIcon({ open = false }: { open?: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

/** A note's glyph, drawn in the folder glyph's column. */
export function TreeFileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

// A folder's children. Opening a folder is not an animation: the rows are
// there on the frame the click is handled, which is what a tree that is being
// navigated wants — the tween's reveal cost more than it read. The wrapper
// stays so the branch keeps its own box: `min-w-0` is load-bearing, not
// tidying, because TREE_ROW_BLEED gives every row 999px of left padding and
// without it the column sizes itself to that and overflows the panel to the
// RIGHT, pushing each row's trailing menu past the panel's clipped edge.
export function TreeBranch({ open, children }: { open: boolean; children: React.ReactNode }) {
  if (!open) return null;
  return <div className="min-w-0">{children}</div>;
}
