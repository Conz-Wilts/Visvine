import { clsx } from 'clsx';
import { asFileKind, FILE_GLYPH, FILE_TONE } from './fileKinds';

const SIZE = {
  sm: 'h-7 w-7 rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5',
  md: 'h-9 w-9 rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]',
  lg: 'h-14 w-14 rounded-xl [&>svg]:h-7 [&>svg]:w-7',
  xl: 'h-24 w-24 rounded-2xl [&>svg]:h-11 [&>svg]:w-11',
} as const;

/**
 * A resource's kind as a tile: the kind's glyph in its ink on its wash
 * (tokens `color.file.*`). The one mark every list, grid, card and viewer
 * draws for a file, so a PDF is the same red square everywhere.
 */
export default function FileTypeIcon({
  kind,
  size = 'md',
  className,
}: {
  kind: string | null | undefined;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const k = asFileKind(kind);
  const Glyph = FILE_GLYPH[k];
  return (
    <span className={clsx('inline-flex shrink-0 items-center justify-center', SIZE[size], FILE_TONE[k], className)} aria-hidden="true">
      <Glyph strokeWidth={size === 'xl' || size === 'lg' ? 1.75 : 2} />
    </span>
  );
}
