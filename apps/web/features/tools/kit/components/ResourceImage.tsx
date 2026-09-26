import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { useVisvineMaybe } from '../hooks';

export interface ResourceImageProps {
  /** A resource id, or null for the fallback. */
  id: string | null | undefined;
  /** What the picture is of — its initials are the fallback. */
  alt: string;
  shape?: 'square' | 'circle';
  size?: number;
  className?: string;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/**
 * A picture from the space's Drive — its thumb, read through the bridge under
 * permissions.resources.read — or the initials of what it is of while there is
 * none, or none the Tool may read.
 */
export function ResourceImage({ id, alt, shape = 'square', size = 40, className }: ResourceImageProps) {
  const visvine = useVisvineMaybe();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!id || !visvine) return;
    let alive = true;
    visvine.resources
      .blob(id, 'thumb')
      .catch(() => visvine.resources.blob(id, 'original'))
      .then((b) => { if (alive) setSrc(b.dataUrl); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id, visvine]);
  const round = shape === 'circle' ? 'rounded-full' : 'rounded-lg';
  return src ? (
    <img src={src} alt={alt} width={size} height={size} className={clsx('shrink-0 object-cover', round, className)} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-label={alt}
      role="img"
      className={clsx('flex shrink-0 items-center justify-center bg-surface-subtle font-semibold text-fg-muted', round, className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size / 2.8)) }}
    >
      {initials(alt)}
    </span>
  );
}
