import { clsx } from 'clsx';
import type { Tone } from '@/features/shared/lib/statusTone';
import { TONE_DOT } from '../lib/rowState';

/** An 8px dot in a tone's colour — the whole of an agent's status glyph. */
export default function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', TONE_DOT[tone], className)} />;
}
