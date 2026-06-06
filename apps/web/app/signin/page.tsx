import { redirect } from "next/navigation";

/**
 * Sign-in is now a popup over the marketing home rather than a standalone page.
 * Everything that still points at `/signin` — middleware's auth redirect,
 * protected-page `redirect()`s, the OAuth error callbacks, old links/bookmarks —
 * bounces here and is forwarded to the home screen with the popup auto-opened
 * (see `?signin=1` handling in `MarketingShell`). `callbackUrl`/`error` ride
 * along so the popup still returns the user to where they were headed.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const params = new URLSearchParams({ signin: "1" });
  if (callbackUrl) params.set("callbackUrl", callbackUrl);
  if (error) params.set("error", error);
  redirect(`/?${params.toString()}`);
}
