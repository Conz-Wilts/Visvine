/**
 * Predictable, ranked matching of a query against a name — the rule the
 * space switcher and the Create panel share. Name-only, because these are
 * things you know by name; matching descriptions made every venture firm
 * match "ven". Ranking: exact > prefix > word-start > substring. Returns
 * -Infinity for no match. `query` is expected lower-cased and trimmed.
 */
export function scoreName(name: string, query: string): number {
  const lower = name.toLowerCase();
  if (lower === query) return 100000;
  if (lower.startsWith(query)) return 90000 - query.length;
  // Any word in the name starts with the query, e.g. "ven" → "Blackbird Ventures".
  if (lower.split(/[^a-z0-9]+/).some((word) => word.startsWith(query))) {
    return 80000 - lower.indexOf(query);
  }
  const idx = lower.indexOf(query);
  if (idx > 0) return 70000 - idx * 10;
  return -Infinity;
}
