/**
 * Pure normalization helpers for cross-space identity resolution.
 *
 * These turn raw, messy field values (typed names, pasted LinkedIn URLs, website
 * URLs with protocols/paths) into stable comparison keys. They are deliberately
 * dependency-free and side-effect-free so the matching logic in ./match.ts can be
 * unit-tested without a database. See lib/identity/resolve.ts for the DB layer.
 */

import { normalizeLinkedIn } from '../eventUtils';

/** Lowercased, trimmed email — or null if it isn't a plausible email. */
export function normalizeEmail(email?: string | null): string | null {
  const e = email?.trim().toLowerCase();
  if (!e) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * Canonical LinkedIn handle for matching, e.g. "linkedin.com/in/craig-piggott".
 * Only fires when the value actually references LinkedIn (a name typed into a
 * LinkedIn field must NOT be coerced into a fake handle), and never returns the
 * empty "linkedin.com/in/" shell.
 */
export function linkedinHandle(url?: string | null): string | null {
  const raw = url?.trim().toLowerCase();
  if (!raw) return null;
  if (!raw.includes('linkedin.com') && !raw.startsWith('in/')) return null;
  const path = normalizeLinkedIn(raw)
    .replace(/^https?:\/\//, '')
    .replace(/^linkedin\.com\/in\//, '')
    .replace(/^linkedin\.com\//, '');
  return path ? `linkedin.com/in/${path}` : null;
}

/** Bare registrable domain for an org website, e.g. "halter.io" — or null. */
export function websiteDomain(url?: string | null): string | null {
  const raw = url?.trim().toLowerCase();
  if (!raw) return null;
  const domain = raw
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .trim();
  return domain && domain.includes('.') ? domain : null;
}

/** Strip diacritics, punctuation and case — the shared base for name/token keys. */
function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Blocking/equality key for a person or org name. */
export function nameKey(name?: string | null): string {
  return name ? fold(name) : '';
}

/** Generic token key (e.g. a location/city) — null when empty after folding. */
export function normalizeToken(value?: string | null): string | null {
  if (!value) return null;
  const f = fold(value);
  return f || null;
}

/**
 * Company key for name+company matching: folded, with common legal/entity suffixes
 * removed so "Halter Inc" and "Halter" compare equal.
 */
export function normalizeCompany(company?: string | null): string | null {
  if (!company) return null;
  const f = fold(company)
    .replace(/\b(inc|incorporated|llc|ltd|limited|co|corp|corporation|company|gmbh|pty|plc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return f || null;
}
