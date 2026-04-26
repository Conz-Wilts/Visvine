'use client';

import { useEffect, useState } from 'react';
import { useDebounce } from './useDebounce';

export interface PersonSearchResult {
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
 * Fuzzy search People nodes across all communities.
 * Debounces input by 300ms, deduplicates cross-community matches.
 */
export function usePersonSearch(name: string, email: string) {
  const debouncedName = useDebounce(name.trim(), 300);
  const debouncedEmail = useDebounce(email.trim(), 300);
  const [results, setResults] = useState<PersonSearchResult[]>([]);
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
        const fetches: Promise<PersonSearchResult[]>[] = [];

        const doFetch = async (field: string, query: string): Promise<PersonSearchResult[]> => {
          const res = await fetch(`/api/nodes/search?q=${encodeURIComponent(query)}&field=${field}`, {
            signal: controller.signal,
          });
          if (!res.ok) {
            console.error(`Person search ${field} failed:`, res.status, await res.text().catch(() => ''));
            return [];
          }
          const d = await res.json();
          return d.results ?? [];
        };

        if (nameQuery) fetches.push(doFetch('name', nameQuery));
        if (emailQuery) fetches.push(doFetch('email', emailQuery));

        const allResults = (await Promise.all(fetches)).flat();

        // Deduplicate: prefer entry with most filled fields
        const deduped = deduplicateResults(allResults);
        setResults(deduped);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error('Person search error:', e);
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }

    search();
    return () => controller.abort();
  }, [debouncedName, debouncedEmail]);

  return { results, loading };
}

function deduplicateResults(results: PersonSearchResult[]): PersonSearchResult[] {
  const map = new Map<string, PersonSearchResult>();

  for (const r of results) {
    const email = (r.metadata?.email as string)?.toLowerCase() ?? '';
    const key = `${r.name.toLowerCase()}|${email}`;

    const existing = map.get(key);
    if (!existing || fieldCount(r) > fieldCount(existing)) {
      map.set(key, r);
    }
  }

  return Array.from(map.values());
}

function fieldCount(r: PersonSearchResult): number {
  let count = 0;
  if (r.subtitle) count++;
  if (r.location) count++;
  if (r.tags?.length) count++;
  if (r.image_url) count++;
  if (r.metadata?.email) count++;
  return count;
}
