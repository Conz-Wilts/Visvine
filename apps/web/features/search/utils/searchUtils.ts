/**
 * Search and fuzzy matching utilities
 */

const NON_WORD_BOUNDARY = /[^a-z0-9]+/;

/**
 * Tokenize a string into searchable words
 */
export function tokenize(rawValue: string): string[] {
  const value = rawValue.trim().toLowerCase();
  if (!value) return [];
  return value.split(NON_WORD_BOUNDARY).filter(Boolean);
}

/**
 * Score token-to-token matching for fuzzy search
 * Returns positive score if any query token fuzzy-matches any candidate token
 */
export function scoreCandidate(queryTokens: string[], candidateTokens: string[]): number {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  let bestScore = 0;

  for (const queryToken of queryTokens) {
    for (const candidateToken of candidateTokens) {
      // Exact match
      if (queryToken === candidateToken) {
        bestScore = Math.max(bestScore, 1000);
        continue;
      }

      // Substring match
      if (candidateToken.includes(queryToken)) {
        bestScore = Math.max(bestScore, 500);
        continue;
      }

      // Fuzzy match with Levenshtein distance
      const distance = levenshteinDistance(queryToken, candidateToken);
      const maxLength = Math.max(queryToken.length, candidateToken.length);

      // Only count as match if distance is small relative to length
      if (distance <= Math.ceil(maxLength * 0.4)) {
        const score = 100 - (distance * 10);
        bestScore = Math.max(bestScore, score);
      }
    }
  }

  return bestScore;
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const distance: number[] = new Array(cols).fill(0);

  for (let j = 0; j < cols; j += 1) {
    distance[j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    let previousDiagonal = distance[0];
    distance[0] = i;

    for (let j = 1; j < cols; j += 1) {
      const temp = distance[j];
      if (a[i - 1] === b[j - 1]) {
        distance[j] = previousDiagonal;
      } else {
        distance[j] = Math.min(
          previousDiagonal + 1,
          distance[j] + 1,
          distance[j - 1] + 1
        );
      }
      previousDiagonal = temp;
    }
  }

  return distance[cols - 1];
}

/**
 * Score a candidate string against a query (used by other utility functions)
 */
function scoreCandidateString(
  candidate: string | undefined | null,
  query: string
): { score: number; distance: number } {
  if (!candidate) {
    return {
      score: Number.NEGATIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY
    };
  }

  const normalizedCandidate = candidate.trim().toLowerCase();
  if (!normalizedCandidate) {
    return {
      score: Number.NEGATIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY
    };
  }

  // Exact match
  if (normalizedCandidate === query) {
    return { score: 1000, distance: 0 };
  }

  // Substring match
  const substringIndex = normalizedCandidate.indexOf(query);
  if (substringIndex !== -1) {
    return {
      score: 500 - substringIndex,
      distance: 0
    };
  }

  // Token-based fuzzy matching
  const tokens = tokenize(normalizedCandidate);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const token of tokens) {
    const distance = levenshteinDistance(query, token);
    if (distance < bestDistance) {
      bestDistance = distance;
    }
  }

  // Fallback to whole string comparison
  if (!Number.isFinite(bestDistance)) {
    bestDistance = levenshteinDistance(query, normalizedCandidate);
  }

  return {
    score: -bestDistance,
    distance: bestDistance
  };
}

/**
 * Find the best matching item from a list of candidates
 */
export function findBestMatch<T>(
  items: T[],
  query: string,
  getCandidates: (item: T) => (string | undefined | null)[]
): T | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return null;

  let bestItem: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const item of items) {
    const candidates = getCandidates(item);

    for (const candidate of candidates) {
      const { score, distance } = scoreCandidateString(candidate, normalizedQuery);
      
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
        bestScore = score;
        bestDistance = distance;
        bestItem = item;
      }

      // Early exit on perfect match
      if (bestScore === 1000) {
        return bestItem;
      }
    }
  }

  if (bestItem == null) return null;

  // Require reasonably close match to avoid jumpy results
  if (bestScore < 0 && bestDistance > Math.max(2, Math.ceil(normalizedQuery.length * 0.6))) {
    return null;
  }

  return bestItem;
}

/**
 * Score a candidate with a priority weight
 */
function scoreCandidateWeighted(
  candidate: string | undefined | null,
  query: string,
  weight: number
): { score: number; distance: number } {
  if (!candidate) {
    return {
      score: Number.NEGATIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY
    };
  }

  const normalizedCandidate = candidate.trim().toLowerCase();
  if (!normalizedCandidate) {
    return {
      score: Number.NEGATIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY
    };
  }

  // Exact match
  if (normalizedCandidate === query) {
    return { score: 1000 * weight, distance: 0 };
  }

  // Substring match (earlier position = better)
  const substringIndex = normalizedCandidate.indexOf(query);
  if (substringIndex !== -1) {
    return {
      score: (500 - substringIndex * 10) * weight,
      distance: 0
    };
  }

  // Token-based fuzzy matching
  const tokens = tokenize(normalizedCandidate);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const token of tokens) {
    const distance = levenshteinDistance(query, token);
    if (distance < bestDistance) {
      bestDistance = distance;
    }
  }

  // Fallback to whole string comparison
  if (!Number.isFinite(bestDistance)) {
    bestDistance = levenshteinDistance(query, normalizedCandidate);
  }

  return {
    score: -bestDistance * weight,
    distance: bestDistance
  };
}

/**
 * Interface for items that can be scored for search
 */
export interface SearchableItem {
  name: string;
  subtitle?: string | null;
  location?: string | null;
  tags?: string[] | null;
}

/**
 * Score an item based on weighted fuzzy matching across all fields
 * Returns both the score and whether it passes quality threshold
 */
export function scoreItemMatch(
  item: SearchableItem,
  query: string
): { score: number; passesThreshold: boolean } {
  const normalizedQuery = query.trim().toLowerCase();
  
  if (!normalizedQuery) {
    return { score: 0, passesThreshold: true };
  }

  // Define weighted candidates (higher weight = higher priority)
  const weightedFields = [
    { value: item.name, weight: 100 },           // Name gets highest priority
    { value: item.subtitle, weight: 10 },        // Subtitle gets medium-high priority
    { value: item.location, weight: 2 },         // Location gets low priority
    ...((item.tags ?? []).map(tag => ({ value: tag, weight: 1 }))) // Tags get lowest priority
  ];

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const { value, weight } of weightedFields) {
    const { score, distance } = scoreCandidateWeighted(value, normalizedQuery, weight);
    
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      bestScore = score;
      bestDistance = distance;
    }
  }

  // Quality threshold: require reasonable match quality
  const passesThreshold = bestScore >= 0 || 
    (bestScore < 0 && bestDistance <= Math.max(2, Math.ceil(normalizedQuery.length * 0.6)));

  return { score: bestScore, passesThreshold };
}

