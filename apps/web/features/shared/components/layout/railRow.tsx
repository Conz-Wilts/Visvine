import Link from "@/features/shared/components/SpaceLink";
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
export const COLLAPSED_W = 76;
export const EXPANDED_W = 272;
export const ROW_INSET = 0;   // row ↔ rail edge: none, a row runs edge to edge
// The glyph column is the same width open or closed, and it is the CLOSED
// rail's full inner width — so a glyph's centre lands on the closed width / 2
// in both states and nothing about it moves when the rail opens. The rail
// sets the variable (the desktop shell's is wider — features/desktop/lib/chrome.ts);
// COLLAPSED_W is the browser's.
export const RAIL_CELL_VAR = "--rail-cell-w";
const GLYPH_CELL_W = `var(${RAIL_CELL_VAR}, ${COLLAPSED_W - ROW_INSET * 2}px)`;
// A row is a little taller than the glyph column is wide, so the hover block
// under a shut row is the full width of the rail — the whole cell is the
// target, not just the glyph. The rail's panels — the space list, the Create list —
// draw their rows on this same square: ROW_H tall, the mark centred in a cell
// ROW_H wide, the name LABEL_ML beyond it, so the list beside the rail reads
// as more of the rail.
export const ROW_H = 62;
export const LABEL_ML = 8;    // glyph cell → label, on the open row
// Row ↔ row, and row ↔ hairline. None: the tiles stack flush, and a band's
// line sits directly against the tile on either side of it. The same open or
// closed — the rail's geometry must not depend on which state it is in.
export const ITEM_GAP = 0;
// The space switcher's head row is drawn by SpaceSelector rather than by Row,
// so it takes ROW_INSET and this cell — the avatar is centred in the one glyph
// column and its hover block is the same square as every row below it.
export const HEAD_CELL_W = GLYPH_CELL_W;
// The rail's two ends — the space at its head, you at its foot — are each a
// band of one row, held between hairlines, and each is drawn square: as tall
// as the rail is wide inside its right seam. The rail's own border takes a
// pixel of its width, hence the one off.
export const END_ROW_H = `calc(${GLYPH_CELL_W} - 1px)`;
// The nav icons ship at h-5 w-5 from the feature registry (they are also drawn
// on the launcher cards at that size); the rail draws them larger, so each cell
// scales its own svg rather than the registry carrying a second set.
//
// 31px, not 22: the two rows of the top group are drawn at 40 (the Create disc,
// and the compass sized to match it), and a 22px glyph under them read as a
// different, smaller family rather than the same column continuing. This sits
// close enough to belong to them while staying plainly subordinate — the row
// you come here to press is still the one drawn largest.
const GLYPH = "[&>svg]:h-[31px] [&>svg]:w-[31px]";
// One row shape for every entry — Create, each tool, More, each account action.
// At rest a row is bare: no border, no fill, just the glyph (and the label once
// the rail is open). The block appears under the pointer only — square-cornered,
// edge to edge, so shut it is a square tile of the rail rather than a pill.
export const ROW_CLASS =
  "relative z-10 flex w-full items-center transition-colors duration-150 hover:bg-surface-3";
// Sign out is the one row that undoes something, so it says so under the
// pointer: the same red the danger buttons use, on the row's own hover block.
// It carries no colour at rest — a red row in the band would read as an alert
// rather than as the last thing you do.
const ROW_DANGER_CLASS =
  "relative z-10 flex w-full items-center transition-colors duration-150 hover:bg-red-50 hover:text-red-600";
export const ROW_TEXT = "text-[15px] whitespace-nowrap";
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
  danger = false,
  square = false,
  expanded,
  reduced,
  ...aria
}: {
  label: string;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  /** The row undoes something — it goes red under the pointer (Sign out). */
  danger?: boolean;
  badge?: ReactNode;
  /** One of the rail's ends — the row is END_ROW_H tall, a square. */
  square?: boolean;
  expanded: boolean;
  /** prefers-reduced-motion — no fade, the name is simply there or not. */
  reduced: boolean;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog" | "menu";
}) {
  const height = square ? END_ROW_H : ROW_H;
  const inner = (
    <>
      {/* Icon: the one glyph column, identical open or closed */}
      <span
        className={`relative flex shrink-0 items-center justify-center ${GLYPH}`}
        style={{ width: GLYPH_CELL_W, height }}
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
  // A danger row's resting colour is INHERITED from the wrapper rather than set
  // on the row: an inline colour would win over the hover rule and the row
  // would never turn. Every other row keeps it inline, where it always was.
  const style = danger
    ? { height, transition: "color 0.2s, background-color 0.15s" }
    : { height, color: rowColor(active), transition: "color 0.2s, background-color 0.15s" };
  const rowClass = danger ? ROW_DANGER_CLASS : ROW_CLASS;

  return (
    <div className="relative" style={danger ? { color: rowColor(active) } : undefined}>
      {href ? (
        <Link href={href} className={rowClass} style={style} aria-label={label}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={rowClass} style={style} aria-label={label} {...aria}>
          {inner}
        </button>
      )}
    </div>
  );
}
