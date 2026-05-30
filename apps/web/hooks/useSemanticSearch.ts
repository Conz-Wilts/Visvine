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
  const [semanticError, setSemanticError] = useState<string | null>(null);

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
      setSemanticError(null);
      return;
    }

    setIsSemanticSearch(true);
    setSemanticLoading(true);
    setSemanticError(null);

    try {
      const response = await fetch('/api/search/semantic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, communityId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        const message = body?.error || `Search failed (${response.status})`;
        throw new Error(message);
      }

      const data = await response.json();
      setSemanticResults(data.results || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Search failed';
      console.error('Semantic search failed:', message);
      setSemanticResults([]);
      setSemanticError(message);
    } finally {
      setSemanticLoading(false);
    }
  }, []);

  const clearSemanticSearch = useCallback(() => {
    setIsSemanticSearch(false);
    setSemanticResults([]);
    setSemanticError(null);
  }, []);

  return {
    semanticResults,
    sortedSemanticResults,
    isSemanticSearch,
    semanticLoading,
    semanticError,
    performSemanticSearch,
    clearSemanticSearch
  };
}



