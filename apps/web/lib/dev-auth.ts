// Dev-only auth bypass guard. Both NODE_ENV and ENABLE_DEV_AUTH must be set.
// NODE_ENV is "production" in any `next build` output, so even if
// ENABLE_DEV_AUTH=true leaks into a prod env, this returns false.
export function isDevAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.ENABLE_DEV_AUTH === "true"
  );
}

export function devAuthDisabledResponse(): Response {
  return new Response("Not Found", { status: 404 });
}
