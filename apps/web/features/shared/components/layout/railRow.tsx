import Link from "next/link";
import type { ReactNode } from "react";

/*
 * The rail's geometry and its one row shape, shared by the rail itself
 * (Sidebar) and by the account band at its foot (UserMenu) so both columns are
 * drawn by the same numbers rather than by two sets that drift.
 */

// Exported so the AuthLayout's content inset and the rail track the exact same
// widths — change them here and the whole shell stays in sync.
// The closed rail is a column of glyphs: wide enough to hold one at a size you
// can read at a glance, with air either side of it.
export const COLLAPSED_W = 68;
export const EXPANDED_W = 256;
export const ROW_INSET = 0;   // row ↔ rail edge: none, a row runs edge to edge
// The glyph column is the same width open or closed, and it is the CLOSED
// rail's full inner width — so a glyph's centre lands on COLLAPSED_W / 2 in
// both states and nothing about it moves when the rail opens.
const GLYPH_CELL_W = COLLAPSED_W - ROW_INSET * 2;
// A row is a little taller than the glyph column is wide, so the hover block
// under a shut row is the full width of the rail — the whole cell is the
// target, not just the glyph. The rail's panels — the space list, the Create list —
// draw their rows on this same square: ROW_H tall, the mark centred in a cell
// ROW_H wide, the name LABEL_ML beyond it, so the list beside the rail reads
// as more of the rail.
export const ROW_H = 56;
export const LABEL_ML = 8;    // glyph cell → label, on the open row
// Row ↔ row, and row ↔ hairline. None: the tiles stack flush, and a band's
// line sits directly against the tile on either side of it. The same open or
// closed — the rail's geometry must not depend on which state it is in.
export const ITEM_GAP = 0;
// The space switcher's head row is drawn by SpaceSelector rather than by Row,
// so it takes ROW_INSET and this cell — the avatar is centred in the one glyph
// column and its hover block is the same square as every row below it.
export const HEAD_CELL_W = GLYPH_CELL_W;
// The nav icons ship at h-5 w-5 from the feature registry (they are also drawn
// on the launcher cards at that size); the rail draws them at 22px unfilled, so
// each cell scales its own svg rather than the registry carrying a second set.
const GLYPH = "[&>svg]:h-[22px] [&>svg]:w-[22px]";
// One row shape for every entry — Create, each tool, More, each account action.
// At rest a row is bare: no border, no fill, just the glyph (and the label once
// the rail is open). The block appears under the pointer only — square-cornered,
// edge to edge, so shut it is a square tile of the rail rather than a pill.
export const ROW_CLASS =
  "relative z-10 flex w-full items-center transition-colors duration-150 hover:bg-surface-3";
export const ROW_TEXT = "text-[14px] whitespace-nowrap";
// A name fades in once the rail is open and is gone before it shuts. The
// rail's width takes 300ms, and a label revealed BY that width reads as sliding
// out from under the glyph column — so it is held back until the width has
// arrived.
const LABEL_FADE_MS = 140;
const LABEL_FADE_IN_DELAY_MS = 200;
function labelFade(show: boolean, reduced: boolean) {
  return {
    opacity: show ? 1 : 0,
    transition: reduced
      ? "none"
      : `opacity ${LABEL_FADE_MS}ms ease ${show ? LABEL_FADE_IN_DELAY_MS : 0}ms`,
  };
}

// Active is carried by weight and colour, not by a coloured pill: the current
// surface is the dark, semibold row; everything else sits muted until hovered.
function rowColor(active: boolean) {
  return active ? "var(--shell-fg-strong, #111827)" : "var(--shell-fg-muted, #111827)";
}

/**
 * Every row in the rail is this shape, whichever band it sits in: a glyph on the
 * rail's one icon column, and a name beside it once the rail is open. Shut, the
 * row is the glyph alone. The glyph itself never moves — same cell, same row
 * height, same gap in both states.
 */
export function Row({
  label,
  icon,
  href,
  onClick,
  active = false,
  badge,
  expanded,
  reduced,
  ...aria
}: {
  label: string;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  badge?: ReactNode;
  expanded: boolean;
  /** prefers-reduced-motion — no fade, the name is simply there or not. */
  reduced: boolean;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog" | "menu";
}) {
  const inner = (
    <>
      {/* Icon: the one glyph column, identical open or closed */}
      <span
        className={`relative flex shrink-0 items-center justify-center ${GLYPH}`}
        style={{ width: GLYPH_CELL_W, height: ROW_H }}
      >
        {icon}
        {badge}
      </span>
      {/* The open name. Always mounted so it can fade rather than be wiped in
          by the widening rail; while the rail is shut it is transparent AND
          clipped, so it is not on screen either way. */}
      <span
        aria-hidden
        className={`${ROW_TEXT} ${active ? "font-semibold" : "font-normal"}`}
        style={{ marginLeft: LABEL_ML, ...labelFade(expanded, reduced) }}
      >
        {label}
      </span>
    </>
  );
  const style = { height: ROW_H, color: rowColor(active), transition: "color 0.2s, background-color 0.15s" };

  return (
    <div className="relative">
      {href ? (
        <Link href={href} className={ROW_CLASS} style={style} aria-label={label}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={ROW_CLASS} style={style} aria-label={label} {...aria}>
          {inner}
        </button>
      )}
    </div>
  );
}
