// The one shape a label wears in this app: a rounded square.
//
// Node types, space aliases and tags are all the same object to a reader —
// a short coloured word that says what something is — so they are all drawn by
// this component. Before it, the same alias was a `rounded-full` pill in the
// console's Types tab, a `rounded-md` square on the directory card, a bordered
// capsule on the profile hero and a colourless toggle on the invite panel; four
// shapes for one idea. `rounded-md` won because it is what the surfaces that
// show types and tags side by side (the note header, the directory toolbar)
// already used.
//
// Tones, not variants: `solid` is the chip painted in its own colour (the
// colour IS the identity, and the label is white on top of it), `muted` is a
// chip with no colour of its own, and `dashed` is the empty slot that invites
// one ("+ Add tag"). A coloured chip is painted the same everywhere, the data
// grid included — one look for one idea.
//
// `chipClass`/`chipStyle` are exported for the handful of places that need the
// look on markup they must own themselves (a dropdown trigger with a chevron,
// a chip wrapping a colour picker). Reach for <Chip> first.

import { clsx } from 'clsx';
import { XIcon } from '@/features/shared/icons';
import type { CSSProperties, ReactNode } from 'react';

export type ChipTone = 'solid' | 'muted' | 'dashed';
export type ChipSize = 'xs' | 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex max-w-full items-center rounded-lg font-semibold leading-normal whitespace-nowrap';

const SIZE_CLASS: Record<ChipSize, string> = {
  xs: 'h-5 gap-1 px-[7px] text-[10px]',
  sm: 'h-[22px] gap-1 px-2 text-[11px]',
  md: 'h-6 gap-1 px-2 text-[12px]',
  lg: 'h-7 gap-1.5 px-2.5 text-[13px]',
};

/** Room for the remove button, which brings its own right-hand padding. */
const REMOVABLE_PAD: Record<ChipSize, string> = {
  xs: 'pr-0.5',
  sm: 'pr-0.5',
  md: 'pr-1',
  lg: 'pr-1',
};

const ICON_CLASS: Record<ChipSize, string> = {
  xs: 'h-2.5 w-2.5',
  sm: 'h-3 w-3',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
};

const TONE_CLASS: Record<ChipTone, string> = {
  solid: 'text-white',
  muted: 'bg-surface-3 text-text-secondary',
  // Hover is left to the caller: some empty slots brighten to the surface's own
  // accent, others just to the text colour, and two competing `hover:text-*`
  // rules resolve by stylesheet order rather than by the order they're written.
  dashed: 'border border-dashed border-border-default text-text-muted transition-colors disabled:opacity-40',
};

/**
 * The hover an empty slot takes on a surface that has an accent colour — set
 * `--accent` on the element and it lights up in the entity's own colour.
 */
export const CHIP_ACCENT_HOVER =
  'hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]';

/**
 * A solid chip with nothing to colour it falls back to the neutral chip rather
 * than rendering invisibly — callers pass `color` straight from data that may
 * not have one (a node type the console never configured, an alias-less member).
 */
function resolveTone(tone: ChipTone, color?: string | null): ChipTone {
  if (tone === 'solid' && !color) return 'muted';
  return tone;
}

export function chipClass(options?: {
  tone?: ChipTone;
  size?: ChipSize;
  color?: string | null;
  interactive?: boolean;
  removable?: boolean;
  className?: string;
}): string {
  const { tone = 'solid', size = 'sm', color, interactive, removable, className } = options ?? {};
  const resolved = resolveTone(tone, color);
  return clsx(
    BASE,
    SIZE_CLASS[size],
    TONE_CLASS[resolved],
    removable && REMOVABLE_PAD[size],
    interactive && 'transition-opacity hover:opacity-90',
    className,
  );
}

export function chipStyle(color?: string | null, tone: ChipTone = 'solid'): CSSProperties | undefined {
  if (!color) return undefined;
  return resolveTone(tone, color) === 'solid' ? { background: color } : undefined;
}

interface ChipProps {
  children: ReactNode;
  /** The type/alias/tag colour. Omit for a chip that has none. */
  color?: string | null;
  tone?: ChipTone;
  size?: ChipSize;
  /** Renders the chip as a button. */
  onClick?: () => void;
  /** Adds a trailing remove button. The chip stays a <span> so the two clicks don't nest. */
  onRemove?: () => void;
  removeLabel?: string;
  /** Blocks the remove button alone — an in-flight save mustn't dim the chip it's saving. */
  removeDisabled?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export default function Chip({
  children,
  color,
  tone = 'solid',
  size = 'sm',
  onClick,
  onRemove,
  removeLabel,
  removeDisabled,
  disabled,
  title,
  className,
  style,
}: ChipProps) {
  const shellStyle = { ...chipStyle(color, tone), ...style };
  const shellClass = chipClass({
    tone,
    size,
    color,
    interactive: Boolean(onClick),
    removable: Boolean(onRemove),
    className: clsx(disabled && 'opacity-40', className),
  });
  const removeButton = onRemove && (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled || removeDisabled}
      aria-label={removeLabel ?? 'Remove'}
      className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
    >
      <XIcon className={ICON_CLASS[size]} />
    </button>
  );

  if (onRemove) {
    return (
      <span className={shellClass} style={shellStyle} title={title}>
        {onClick ? (
          <button type="button" onClick={onClick} disabled={disabled} className="min-w-0 truncate">
            {children}
          </button>
        ) : (
          <span className="min-w-0 truncate">{children}</span>
        )}
        {removeButton}
      </span>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={shellClass}
        style={shellStyle}
      >
        {children}
      </button>
    );
  }

  return (
    <span className={shellClass} style={shellStyle} title={title}>
      {children}
    </span>
  );
}
