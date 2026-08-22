'use client';

import { useEffect, useState } from 'react';
import { useDebounce } from './useDebounce';

export interface NodeSearchResult {
  id: string;
  /** Canonical cross-space identity, when the node has been resolved to one. */
  identity_id: string | null;
  name: string;
  subtitle: string | null;
  location: string | null;
  tags: string[];
  image_url: string | null;
  space_id: string | null;
  space_name: string | null;
  /** All spaces this identity appears in (for the finder badge). */
  spaces?: string[];
  /** The row is the identity's Visvine record; picking it binds the new card to the record. */
  global?: boolean;
  metadata: Record<string, unknown> | null;
}

/**
 * Fuzzy-search nodes of a given type across all spaces, so you can find an
 * existing entry to re-add to the current space instead of recreating it.
 * Debounces input by 300ms and deduplicates cross-space matches.
 *
 * `email` is only meaningful for `person` (people store an email in metadata);
 * pass it to also match on email. Other types match by name only.
 */
export function useNodeSearch(name: string, type: string, email = '') {
  const debouncedName = useDebounce(name.trim(), 300);
  const debouncedEmail = useDebounce(email.trim(), 300);
  const [results, setResults] = useState<NodeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function search() {
      // Need at least one query with 2+ chars
      const nameQuery = debouncedName.length >= 2 ? debouncedName : '';
      const emailQuery = debouncedEmail.length >= 2 ? debouncedEmail : '';

      if (!nameQuery && !emailQuery) {
        setResults([]);
        return;
      }

      setLoading(true);

      try {
        const doFetch = async (field: string, query: string): Promise<NodeSearchResult[]> => {
          const res = await fetch(
            `/api/nodes/search?q=${encodeURIComponent(query)}&field=${field}&type=${encodeURIComponent(type)}`,
            { signal: controller.signal },
          );
          if (!res.ok) {
            console.error(`Node search ${field} failed:`, res.status, await res.text().catch(() => ''));
            return [];
          }
          const d = await res.json();
          return d.results ?? [];
        };

        const fetches: Promise<NodeSearchResult[]>[] = [];
        if (nameQuery) fetches.push(doFetch('name', nameQuery));
        if (emailQuery) fetches.push(doFetch('email', emailQuery));

        const allResults = (await Promise.all(fetches)).flat();

        // Deduplicate: prefer entry with most filled fields
        setResults(deduplicateResults(allResults));
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error('Node search error:', e);
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }

    search();
    return () => controller.abort();
  }, [debouncedName, debouncedEmail, type]);

  return { results, loading };
}

function deduplicateResults(results: NodeSearchResult[]): NodeSearchResult[] {
  const map = new Map<string, NodeSearchResult>();

  for (const r of results) {
    // The server already collapses node rows by canonical identity; this only
    // re-merges the same identity returned by both the name and email fetches.
    // Rows with no identity yet stay distinct by node id.
    const key = r.identity_id ?? `node:${r.id}`;
    const existing = map.get(key);
    // The Visvine record leads its identity whatever the field count.
    if (!existing || (r.global && !existing.global) || (!existing.global && fieldCount(r) > fieldCount(existing))) {
      map.set(key, r);
    }
  }

  return Array.from(map.values());
}

function fieldCount(r: NodeSearchResult): number {
  let count = 0;
  if (r.subtitle) count++;
  if (r.location) count++;
  if (r.tags?.length) count++;
  if (r.image_url) count++;
  if (r.metadata?.email) count++;
  return count;
}
