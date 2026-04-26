import { useState, useCallback, useMemo } from 'react';
import type { SemanticSearchResult } from '@/lib/types';

/**
 * Hook for performing semantic searches against the API
 * Handles search state, loading, and results
 */
export function useSemanticSearch() {
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([]);
  const [isSemanticSearch, setIsSemanticSearch] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);

  // Sort semantic results by similarity score (highest first)
  const sortedSemanticResults = useMemo(() =>
    [...semanticResults].sort((a, b) => b.similarity - a.similarity),
    [semanticResults]
  );

  const performSemanticSearch = useCallback(async (query: string, communityId?: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setIsSemanticSearch(false);
      setSemanticResults([]);
      return;
    }

    // Trigger semantic search
    setIsSemanticSearch(true);
    setSemanticLoading(true);

    try {
      const response = await fetch('/api/search/semantic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, communityId }),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setSemanticResults(data.results || []);
    } catch (error) {
      console.error('Semantic search failed:', error);
      setSemanticResults([]);
    } finally {
      setSemanticLoading(false);
    }
  }, []);

  const clearSemanticSearch = useCallback(() => {
    setIsSemanticSearch(false);
    setSemanticResults([]);
  }, []);

  return {
    semanticResults,
    sortedSemanticResults,
    isSemanticSearch,
    semanticLoading,
    performSemanticSearch,
    clearSemanticSearch
  };
}



