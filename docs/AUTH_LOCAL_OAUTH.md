# Google OAuth in local dev vs. Cloud Run

> How to sign in with a real Google account (`connor@visvine.com`) both on the
> deployed Cloud Run site **and** on `localhost`, given that OAuth redirect URIs
> are pinned to fixed URLs.

## TL;DR

You don't have to choose. **Google lets one OAuth client register many redirect
URIs at once, and `http://localhost` is explicitly exempt from the HTTPS rule.**
So you register *both* the production callback and the localhost callback on the
same OAuth client, and the app picks the right one per environment via
`NEXT_PUBLIC_APP_URL`. No code change is needed — `signin/google/route.ts` and
`callback/google/route.ts` already build `redirect_uri` from that env var.

The `/dev/login` bypass stays as the fast everyday local path; real Google login
becomes available locally for when you specifically need to test the OAuth flow
or super-admin behaviour tied to `connor@visvine.com`.

---

## Why this feels like a conflict (and why it isn't)

OAuth requires the `redirect_uri` to be **pre-registered** on the OAuth client —
Google rejects anything that isn't an exact string match. The instinct is "the
redirect is registered for the live site, so localhost can't use it."

Two facts dissolve that:

1. **Multiple authorized redirect URIs per client.** The Google Cloud Console
   "Authorized redirect URIs" field is a *list*. You can have
   `https://app.visvine.com/...` and `http://localhost:3000/...` registered
   simultaneously. Google matches the `redirect_uri` your app sends against the
   list; whichever matches is used.

2. **`localhost` is HTTPS-exempt.** Google's "redirect URIs must be HTTPS" rule
   carves out `http://localhost` (and `http://127.0.0.1`) specifically for local
   development. This is *only* true for loopback — any other host must be HTTPS,
   which is why the mobile flow needs the Cloudflare tunnel.

Your code already chooses the right URI per environment:

```ts
// apps/web/app/api/auth/signin/google/route.ts
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const redirectUri = `${appUrl}/api/auth/callback/google`;
```

So locally `NEXT_PUBLIC_APP_URL=http://localhost:3000` → localhost callback; on
Cloud Run it's the deployed URL → prod callback. Both work *as long as both are
registered.*

---

## How developers usually handle this — the three patterns

| Pattern | What it is | When to use |
|---|---|---|
| **A. One client, many redirect URIs** | Add localhost + prod callbacks to the same OAuth client. | Smallest setup; fine for a solo/small team. **Recommended for Visvine now.** |
| **B. Separate OAuth clients per environment** | A dedicated dev client (`...-dev`) and a prod client, each with its own secret. | When you want prod credentials never to touch dev machines, or a staging tier. The right move as the team/grows. |
| **C. Dev auth bypass** | Skip Google entirely in dev; mint a session directly. | Fastest inner loop; no Google round-trip. You already have this (`/dev/login`). |

These aren't exclusive. The common production-grade combo is **B for the OAuth
side + C for everyday local work** — but **A + C** is the least-effort starting
point and is all you need today.

---

## Recommended setup for Visvine (Pattern A + keep C)

### 1. Register the localhost callbacks on your OAuth client

Google Cloud Console → **APIs & Services → Credentials** → your OAuth 2.0 Client
ID. Add to **Authorized redirect URIs**:

```
https://<your-cloud-run-domain>/api/auth/callback/google
https://<your-cloud-run-domain>/api/auth/callback/google-mobile
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/auth/callback/google-mobile
```

And to **Authorized JavaScript origins** (origins, no path):

```
https://<your-cloud-run-domain>
http://localhost:3000
```

> **Use a custom domain for prod, not the raw `*.run.app` URL.** Cloud Run's
> default URL is stable per service+region now, but mapping a custom domain
> (e.g. `app.visvine.com`) decouples the redirect URI from Cloud Run internals
> and is what you'll want long-term. Map it first, then register *that* URL.

### 2. Set `NEXT_PUBLIC_APP_URL` per environment

- **Local** (`.env` / `.env.local`):
  ```
  NEXT_PUBLIC_APP_URL=http://localhost:3000
  ```
- **Cloud Run** (service env var or Secret Manager):
  ```
  NEXT_PUBLIC_APP_URL=https://app.visvine.com
  ```

Same `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in both (Pattern A). Under
Pattern B you'd instead give each environment its own client id/secret pair.

### 3. Make `connor@visvine.com` a super admin

Logging in via Google works for *any* Google account (the callback auto-creates
a user). What makes `connor@visvine.com` "take you into the site" with full
access is `SUPER_ADMIN_EMAILS` (see `lib/session.ts → isSuperAdmin`):

```
SUPER_ADMIN_EMAILS=connor@visvine.com
```

Set this in both local and Cloud Run env. Super admins bypass the per-community
DB role check.

### 4. (Optional) Restrict who can sign in

Right now any Google account can create an account. If you want to gate it —
e.g. only `@visvine.com` during the private phase — two levers:

- **Soft hint:** add `hd=visvine.com` to the auth URL params in
  `signin/google/route.ts` (Google pre-selects the workspace domain — *not* a
  security boundary; users can still pick another account).
- **Hard check:** in `callback/google/route.ts`, after fetching `googleUser`,
  reject emails whose domain isn't allow-listed (and/or not in
  `SUPER_ADMIN_EMAILS`) before creating the user. This is the real gate.

---

## Day-to-day: which login do I use?

- **Routine local dev** → `/dev/login` (`admin@local.dev` / `member@local.dev`).
  Instant, no Google, no network. Gated by `NODE_ENV=development` **and**
  `ENABLE_DEV_AUTH=true` (`lib/dev-auth.ts`), and 404s in any prod build.
- **Testing the real OAuth flow locally** (callback logic, claim flow,
  onboarding redirect, super-admin path for `connor@visvine.com`) → click the
  real "Sign in with Google" button on `localhost:3000/signin`. Works once the
  localhost redirect URI is registered (step 1).
- **Production** → only the real Google button exists; the dev bypass is
  compiled out.

---

## Gotchas

- **Exact-match URIs.** `http://localhost:3000` ≠ `http://127.0.0.1:3000` ≠
  trailing-slash variants. Register exactly what the app sends. The port matters
  too — if you run dev on a non-3000 port, register that port.
- **Secure cookie + HTTP.** The session cookie sets `secure: NODE_ENV ===
  "production"`. Locally `NODE_ENV=development` → `secure:false`, so the cookie
  works over plain `http://localhost`. In prod it's `secure:true` over HTTPS.
  Don't run a "production" `NODE_ENV` over plain HTTP — the cookie won't stick.
- **Propagation delay.** New redirect URIs in the Google console can take a few
  minutes (occasionally longer) to take effect; a fresh `redirect_uri_mismatch`
  right after editing is usually just propagation.
- **Don't ship the dev bypass open.** `isDevAuthEnabled()` already requires
  `NODE_ENV=development`, which `next build` forces to `production`. Just never
  set `ENABLE_DEV_AUTH=true` on Cloud Run.
- **Mobile is separate.** The native apps use `/callback/google-mobile` + the
  `visvine://` scheme and need HTTPS (hence the tunnel) — they can't use the
  localhost exemption. See `apps/mobile/README.md`.
