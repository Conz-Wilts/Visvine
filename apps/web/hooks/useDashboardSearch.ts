import { useMemo } from 'react';
import type { DirectoryItem } from '@/components/dashboard/types';

/**
 * Hook for filtering directory items based on search term
 * Performs name-based search with relevance scoring
 */
export function useDashboardSearch(items: DirectoryItem[], searchTerm: string) {
  const normalizedSearch = useMemo(() => 
    searchTerm.trim().toLowerCase(),
    [searchTerm]
  );

  const filteredItems = useMemo(() => {
    // When no search term, show all items sorted alphabetically
    if (!normalizedSearch) {
      return [...items].sort((a, b) => a.name.localeCompare(b.name));
    }

    // For grid/table views: strict name-only matching
    // Only show items where the name contains the search term
    const matchedItems = items
      .filter(item => item.name.toLowerCase().includes(normalizedSearch))
      .map(item => {
        const name = item.name.toLowerCase();
        const index = name.indexOf(normalizedSearch);

        // Score based on:
        // 1. Exact match gets highest score
        // 2. Starts with search term gets high score
        // 3. Contains search term gets score based on position
        let score = 0;
        if (name === normalizedSearch) {
          score = 10000;
        } else if (index === 0) {
          score = 5000 - normalizedSearch.length;
        } else {
          score = 1000 - index * 10;
        }

        return { item, score };
      });

    // Sort by relevance score (highest first)
    return matchedItems
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }, [items, normalizedSearch]);

  return {
    filteredItems,
    normalizedSearch
  };
}



