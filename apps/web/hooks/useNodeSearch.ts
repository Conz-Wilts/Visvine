'use client';

import { useEffect, useState } from 'react';
import { useDebounce } from './useDebounce';

export interface NodeSearchResult {
  id: string;
  name: string;
  subtitle: string | null;
  location: string | null;
  tags: string[];
  image_url: string | null;
  community_id: string | null;
  community_name: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Fuzzy-search nodes of a given type across all communities, so you can find an
 * existing entry to re-add to the current community instead of recreating it.
 * Debounces input by 300ms and deduplicates cross-community matches.
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
    const email = (r.metadata?.email as string)?.toLowerCase() ?? '';
    // People come from two fetches (name + email) and may exist in several
    // communities, so collapse the same person by name+email. Types without an
    // email (resource, event) are keyed by node identity instead, so distinct
    // cross-community entries that share a name are all kept rather than merged.
    const key = email
      ? `${r.name.toLowerCase()}|${email}`
      : `${r.id}|${r.community_id ?? ''}`;

    const existing = map.get(key);
    if (!existing || fieldCount(r) > fieldCount(existing)) {
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
