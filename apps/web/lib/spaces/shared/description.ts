// How long a space's description may be. Pure, so the console's counter and
// every door that writes one (the settings route, POST /api/spaces,
// create_space) count the same words.

export const SPACE_DESCRIPTION_MAX_WORDS = 150;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * `text` cut after its `max`-th word, keeping everything typed up to there —
 * so a paste over the limit keeps what fits instead of being refused whole.
 */
export function clampWords(text: string, max = SPACE_DESCRIPTION_MAX_WORDS): string {
  if (countWords(text) <= max) return text;
  const match = text.match(new RegExp(`^\\s*(?:\\S+\\s+){${max - 1}}\\S+`));
  return match ? match[0] : text;
}

export function descriptionDenial(text: string): string | null {
  return countWords(text) > SPACE_DESCRIPTION_MAX_WORDS
    ? `A description is at most ${SPACE_DESCRIPTION_MAX_WORDS} words.`
    : null;
}
