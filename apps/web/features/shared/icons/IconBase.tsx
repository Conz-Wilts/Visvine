/**
 * The one <svg> every owned icon renders through.
 *
 * Icons are ours now — `assets/icons/*.svg` at the repo root, codegen'd into
 * components by apps/web/scripts/build-icons.ts. This module is the hand-written
 * half: the shared chrome (viewBox, paint, caps) that the generated components
 * wrap their geometry in, so a change to how every icon is drawn is one edit
 * here rather than 112 regenerated files.
 *
 * The defaults deliberately match what lucide-react used to emit — 24x24 box,
 * `fill="none"`, `stroke="currentColor"`, round caps and joins — so the
 * migration off it was a rename, not a redraw. Each glyph supplies its own
 * `strokeWidth` default (2 for the lucide-derived art, 1.8 for the house glyphs
 * drawn to the sidebar's spec); a caller can still override it per usage.
 */
import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** Box size in px. Tailwind size classes override this and usually should. */
  size?: number | string;
  /**
   * Accessible name. Icons are decorative by default (`aria-hidden`) because
   * nearly all of ours sit beside their own label; pass a title only when the
   * icon IS the label — an icon-only button, say.
   */
  title?: string;
  /**
   * Pre-sanitized SVG children, injected as innerHTML.
   *
   * The ONE caller is the Tool rail icon (features/tools/components/toolIcons.tsx),
   * where an author's own glyph renders in app chrome. The markup must already
   * have been through `sanitizeToolIcon` (lib/tools/iconSvg.ts) — this prop
   * performs no checking of its own, which is exactly why it is named so
   * awkwardly and documented here rather than being a general escape hatch.
   */
  html?: string;
}

export function IconBase({
  size = 24,
  title,
  children,
  html,
  strokeWidth = 2,
  ...rest
}: IconProps) {
  // `html` and children are mutually exclusive — React refuses an element that
  // has both, and the array this component would otherwise build ([title,
  // children]) counts as children even when every entry is null. So the
  // innerHTML branch returns its own element rather than sharing the one below.
  if (html !== undefined) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={title ? undefined : true}
        role={title ? 'img' : undefined}
        aria-label={title}
        {...rest}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
