// A type is named in the singular, and one table says how to say it in the
// plural.
//
// The vocabulary is singular everywhere it labels a THING — the chip on a card
// says `Person`, because the card is one — and plural everywhere it names a SET
// of them: the tab over the Directory's Person table, the Type filter's rows,
// the `## People` heading in a folder's index. Those two readings are the same
// configured type, so nothing about them belongs in a second column a space has
// to fill in: the plural is derived from the name by the English rule below, and
// `NodeTypeConfig.plural` exists only for the name the rule gets wrong.
//
// Pure and leaf (only a type import), so the index-note contract, the client
// components and the tests all read the one rule.

import type { NodeTypeConfig } from './context';

/**
 * Types whose plural no rule reaches. Deliberately short: each row is a word
 * English inflects irregularly and a space plausibly records — anything rarer
 * is what the `plural` override is for. Keyed lowercase on the LAST word of the
 * name, so `Board Member` and `Point Person` inflect like `member` and
 * `person`.
 */
const IRREGULAR: Record<string, string> = {
  person: 'people',
  child: 'children',
  man: 'men',
  woman: 'women',
  analysis: 'analyses',
  hypothesis: 'hypotheses',
  thesis: 'theses',
  criterion: 'criteria',
};

/** Words that are already their own plural — appending an `s` would be wrong. */
const INVARIANT = new Set([
  'staff', 'news', 'equipment', 'software', 'research', 'feedback', 'data',
  'media', 'info', 'content', 'audio', 'series', 'species',
]);

/** Keep the case the name was written in: `PERSON` → `PEOPLE`, `Person` → `People`. */
function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source !== source.toLowerCase()) return replacement.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

/**
 * A singular name in the plural, by rule. English-shaped and deliberately
 * small — a producer-chosen type the rule mangles still round-trips wherever
 * this is used, because the plural is a LABEL and the singular name is the
 * record.
 *
 * Only the last word inflects, because that is the head of every type name a
 * space writes (`BigQuery Table` → `BigQuery Tables`).
 */
export function pluralizeTypeWord(name: string): string {
  const word = name.trim();
  if (!word) return word;
  const head = word.slice(word.lastIndexOf(' ') + 1);
  const lead = word.slice(0, word.length - head.length);
  const key = head.toLowerCase();
  if (INVARIANT.has(key)) return word;
  const irregular = IRREGULAR[key];
  if (irregular) return `${lead}${matchCase(head, irregular)}`;
  // A head already written plural (`Metrics`) is left alone; `Class` is not.
  if (/[^s]s$/i.test(head)) return word;
  if (/(s|x|z|ch|sh)$/i.test(head)) return `${word}es`;
  if (/[^aeiou]y$/i.test(head)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * What to call a set of things of this type: the space's `plural` for it when
 * an admin wrote one, the rule otherwise.
 *
 * Matched on the type's own name rather than its canonical base — `Company`
 * folds onto `space` for the entity machinery, but a space that records both
 * names each of them itself.
 */
export function pluralTypeName(name: string, nodeTypes?: NodeTypeConfig[]): string {
  const key = name.trim().toLowerCase();
  const stored = (nodeTypes ?? []).find((t) => t.name?.trim().toLowerCase() === key);
  const declared = (stored?.plural ?? '').trim();
  if (declared) return declared;
  // Derived from the STORED spelling when there is one: a `?type=person` out of
  // a URL reads `People`, not `people`.
  return pluralizeTypeWord(stored?.name ?? name);
}

/** Longest a plural may be — it labels a tab, like the name it comes from. */
const MAX_PLURAL = 40;

/** Same shape a type name may take (lib/types/nodeTypeRegistry.ts): a label, not a path. */
const PLURAL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} \-&]*$/u;

/**
 * The stored spelling of a plural somebody typed, or `undefined` for "use the
 * rule" — which is what an empty field, whitespace, a value that only restates
 * what the rule already says, and a value that isn't label-shaped all mean. A
 * redundant override is never stored, so a type renamed later keeps deriving
 * correctly; a rejected one shows as the rule's answer coming back into the
 * field rather than as an error, because the plural is a label and the rule is
 * always a usable one.
 */
export function normalizeTypePlural(raw: string | null | undefined, name: string): string | undefined {
  const collapsed = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_PLURAL);
  if (!collapsed || !PLURAL_PATTERN.test(collapsed)) return undefined;
  if (collapsed.toLowerCase() === pluralizeTypeWord(name).toLowerCase()) return undefined;
  return collapsed;
}
