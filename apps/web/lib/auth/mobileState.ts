/**
 * What a phone app's Google sign-in carries through Google's `state`, read
 * without trusting any of it (pure; tested in tests/auth-mobile-state.test.ts).
 *
 * Google echoes `state` back unchanged, and anyone can build a Google authorize
 * URL that lands on our callback — so every field is an attacker's to choose.
 * Nothing here may therefore decide where a credential goes: the return address
 * is the app's own scheme, fixed in code, and what travels over it is a
 * handoff only the app that holds the verifier can redeem (lib/auth/handoff.ts).
 */
import { isWellFormedChallenge } from './handoff';

/** The one address a phone sign-in ever returns to. */
export const MOBILE_CALLBACK = 'visvine://auth/callback';
const MOBILE_ERROR = 'visvine://auth/error';

const DEFAULT_PATH = '/home';

export interface MobileSignInState {
  /** The app's own nonce, echoed back so it can refuse a return it did not start. */
  nonce: string | null;
  /** base64url(sha256(verifier)); absent from a build that predates the handoff. */
  challenge: string | null;
  /** Where the app lands after signing in: an in-app path, never a URL. */
  callbackUrl: string;
  /** A return address other than the app's own was asked for. */
  foreignRedirect: boolean;
}

/** An in-app path: rooted, no scheme, no host, no protocol-relative `//`. */
export function safeInAppPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  if (!/^\/(?!\/)[A-Za-z0-9/_\-.]*$/.test(value)) return null;
  if (value.includes('..')) return null;
  return value;
}

function nonceOf(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : null;
}

export function parseMobileState(raw: string | null): MobileSignInState {
  const empty: MobileSignInState = {
    nonce: null,
    challenge: null,
    callbackUrl: DEFAULT_PATH,
    foreignRedirect: false,
  };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(decodeURIComponent(raw));
    } catch {
      return empty;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const state = parsed as Record<string, unknown>;
  const redirect = state.redirectUri;
  return {
    nonce: nonceOf(state.state),
    challenge: isWellFormedChallenge(state.challenge) ? state.challenge : null,
    callbackUrl: safeInAppPath(state.callbackUrl) ?? DEFAULT_PATH,
    foreignRedirect: redirect !== undefined && redirect !== MOBILE_CALLBACK,
  };
}

/** The app's error link, carrying its nonce back so it can match the return. */
export function mobileErrorUrl(
  error: string,
  state: Pick<MobileSignInState, 'nonce'>,
  message?: string,
): string {
  const url = new URL(MOBILE_ERROR);
  url.searchParams.set('error', error);
  if (message) url.searchParams.set('message', message);
  if (state.nonce) url.searchParams.set('state', state.nonce);
  return url.toString();
}

/** The app's success link: a handoff, never a session. */
export function mobileHandoffUrl(handoff: string, state: MobileSignInState): string {
  const url = new URL(MOBILE_CALLBACK);
  url.searchParams.set('handoff', handoff);
  url.searchParams.set('callbackUrl', state.callbackUrl);
  if (state.nonce) url.searchParams.set('state', state.nonce);
  return url.toString();
}
