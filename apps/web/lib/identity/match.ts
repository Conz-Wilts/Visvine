/**
 * Pure entity-resolution scoring + decision logic.
 *
 * Given a candidate's signals and a set of already-known identities, decide whether
 * they are the same real person/org. Deterministic + fuzzy tiers only (no ML):
 *
 *   Tier A (auto, strong id): same email / LinkedIn / website domain.
 *   Tier B (auto, name+co):   same normalized name AND same company (person) or
 *                             same name AND same location (org).
 *   Tier C (suggest):         same name (+ optional weak signal) — never auto-merged.
 *
 * Policy chosen by the user: auto-link on strong ids AND on strong name+company;
 * everything weaker is suggested for human confirmation. Kept DB-free so it can be
 * unit-tested; lib/identity/resolve.ts feeds it candidates from Postgres.
 */

import {
  normalizeEmail,
  linkedinHandle,
  websiteDomain,
  nameKey,
  normalizeToken,
  normalizeCompany,
} from './normalize';

export type IdentityKind = 'person' | 'organization';

/** Raw input describing the person/org being added. */
export interface ResolveInput {
  kind: IdentityKind;
  name: string;
  email?: string | null;
  linkedinUrl?: string | null;
  website?: string | null;
  company?: string | null;
  location?: string | null;
}

/** Normalized, comparison-ready form of an input or an existing identity. */
export interface IdentitySignals {
  kind: IdentityKind;
  nameKey: string;
  email: string | null;
  linkedinHandle: string | null;
  websiteDomain: string | null;
  company: string | null;
  location: string | null;
}

export type Decision =
  | 'auto_strong' // Tier A — attached to an existing identity on a strong id
  | 'auto_name_company' // Tier B — attached on name + company/location
  | 'suggested' // Tier C — a possible match exists; NOT attached, queued for review
  | 'created'; // no candidate cleared the bar — a fresh identity

type Tier = 'A' | 'B' | 'C';

export interface CandidateScore {
  tier: Tier | null; // null = not a match at all
  confidence: number;
  reason: string;
}

interface ScoredCandidate {
  identityId: string;
  canonicalName: string;
  score: CandidateScore;
}

export interface MatchResult {
  decision: Decision;
  /** The identity to attach to for auto_*; null for suggested/created. */
  identityId: string | null;
  confidence: number;
  reason: string;
  /** Possible-but-unconfirmed matches (Tier C, and any auto candidate not chosen). */
  suggestions: ScoredCandidate[];
}

// Confidence cutoffs. >= AUTO links automatically; >= SUGGEST is surfaced for a
// human; below SUGGEST is ignored (treated as a different entity).
const AUTO_THRESHOLD = 0.9;
const SUGGEST_THRESHOLD = 0.55;

/** Convert raw input into normalized signals. */
export function toSignals(input: ResolveInput): IdentitySignals {
  return {
    kind: input.kind,
    nameKey: nameKey(input.name),
    email: normalizeEmail(input.email),
    linkedinHandle: linkedinHandle(input.linkedinUrl),
    websiteDomain: websiteDomain(input.website),
    company: normalizeCompany(input.company),
    location: normalizeToken(input.location),
  };
}

/** Score one candidate against the input. Returns the strongest matching tier. */
export function scoreCandidate(input: IdentitySignals, cand: IdentitySignals): CandidateScore {
  const miss: CandidateScore = { tier: null, confidence: 0, reason: 'no match' };
  if (input.kind !== cand.kind) return miss;

  // ── Tier A: strong identifiers ──
  if (input.email && cand.email && input.email === cand.email) {
    return { tier: 'A', confidence: 1.0, reason: 'email match' };
  }
  if (input.linkedinHandle && cand.linkedinHandle && input.linkedinHandle === cand.linkedinHandle) {
    return { tier: 'A', confidence: 0.98, reason: 'linkedin match' };
  }
  if (input.websiteDomain && cand.websiteDomain && input.websiteDomain === cand.websiteDomain) {
    return { tier: 'A', confidence: 0.97, reason: 'website match' };
  }

  // Everything below needs the names to match.
  const sameName = !!input.nameKey && input.nameKey === cand.nameKey;
  if (!sameName) return miss;

  // ── Tier B: name + a corroborating strong-ish signal → auto ──
  if (input.kind === 'person' && input.company && cand.company && input.company === cand.company) {
    return { tier: 'B', confidence: 0.9, reason: 'name + company' };
  }
  if (input.kind === 'organization' && input.location && cand.location && input.location === cand.location) {
    return { tier: 'B', confidence: 0.9, reason: 'name + location' };
  }

  // ── Tier C: name (+ weak signal) → suggest only ──
  if (input.location && cand.location && input.location === cand.location) {
    return { tier: 'C', confidence: 0.8, reason: 'name + location' };
  }
  return { tier: 'C', confidence: 0.6, reason: 'name only' };
}

/**
 * Decide what to do given the input and the blocked candidate identities.
 * `rejectedIdentityIds` are anti-matches recorded for this node ("not the same
 * person") — they are excluded from both auto-linking and suggestions.
 */
export function decideMatch(
  input: IdentitySignals,
  candidates: Array<{ identityId: string; canonicalName: string; signals: IdentitySignals }>,
  rejectedIdentityIds: ReadonlySet<string> = new Set(),
): MatchResult {
  const scored: ScoredCandidate[] = candidates
    .filter((c) => !rejectedIdentityIds.has(c.identityId))
    .map((c) => ({ identityId: c.identityId, canonicalName: c.canonicalName, score: scoreCandidate(input, c.signals) }))
    .filter((c) => c.score.tier !== null)
    .sort((a, b) => b.score.confidence - a.score.confidence);

  if (scored.length === 0) {
    return { decision: 'created', identityId: null, confidence: 0, reason: 'no candidate', suggestions: [] };
  }

  const best = scored[0];

  if (best.score.confidence >= AUTO_THRESHOLD) {
    return {
      decision: best.score.tier === 'A' ? 'auto_strong' : 'auto_name_company',
      identityId: best.identityId,
      confidence: best.score.confidence,
      reason: best.score.reason,
      // Surface any *other* strong candidates so a steward can catch an over-merge.
      suggestions: scored.slice(1).filter((c) => c.score.confidence >= SUGGEST_THRESHOLD),
    };
  }

  if (best.score.confidence >= SUGGEST_THRESHOLD) {
    return {
      decision: 'suggested',
      identityId: null,
      confidence: best.score.confidence,
      reason: best.score.reason,
      suggestions: scored.filter((c) => c.score.confidence >= SUGGEST_THRESHOLD),
    };
  }

  return { decision: 'created', identityId: null, confidence: best.score.confidence, reason: 'below threshold', suggestions: [] };
}
