// Shared client-side fetch wrapper: JSON in/out, throws on !res.ok with the
// server's `{ error }` message when present. Replaces the hand-rolled
// `if (!res.ok) throw new Error(data.error)` pattern in components.

class FetchJsonError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function fetchJson<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. empty 204) — fall through with null.
  }
  if (!res.ok) {
    // 401 means the session is gone (expired, cleared by the server after a
    // stale-user check, or never existed). Without this the app keeps rendering
    // its cached shell and every click surfaces a cryptic fetch error — kick
    // the whole page to sign-in instead so the signed-out state is visible.
    if (res.status === 401 && typeof window !== 'undefined') {
      const callbackUrl = window.location.pathname + window.location.search;
      // A full navigation on purpose — router state may be stale and this file
      // is not a component, so useRouter() is unavailable.
      window.location.assign(
        new URL(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, window.location.origin),
      );
    }
    const message =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new FetchJsonError(res.status, message);
  }
  return data as T;
}

/** POST/PATCH helper: JSON-encodes `body` and sets the content-type header. */
export function fetchJsonBody<T = unknown>(
  input: RequestInfo | URL,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown,
  init?: RequestInit,
): Promise<T> {
  return fetchJson<T>(input, {
    ...init,
    method,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    body: JSON.stringify(body),
  });
}
