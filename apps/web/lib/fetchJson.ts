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
