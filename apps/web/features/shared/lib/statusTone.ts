// The one palette a status chip wears: painted in its colour, labelled in white.
//
// Four copies of this map had grown up side by side — the agents roster, the
// connectors list, a Tool's page and the Tool preview strip all declared their
// own `ok`/`warn`/`bad` classes, and all four drew the same pale-wash-behind-a
// darker-shade look that a coloured chip is not supposed to have (see Chip.tsx,
// which retired its tinted tone for the same reason). One map, painted tones.
//
// `muted` is the exception on purpose: it is the tone for a chip with nothing
// to say, so it has no colour to paint and keeps the neutral surface.

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'live';

export const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-brand-green text-white',
  warn: 'bg-amber-500 text-white',
  bad: 'bg-red-600 text-white',
  muted: 'bg-surface-2 text-text-muted',
  live: 'bg-sky-600 text-white',
};

/** Shell for a status chip: the Chip primitive's shape, without its colour. */
export const TONE_CHIP =
  'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold leading-none';
