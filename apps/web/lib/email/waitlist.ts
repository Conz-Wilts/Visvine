import React from "react";
import { resend } from "@/lib/email/resend";
import { EMAIL_CONFIG } from "@/lib/email/email-constants";
import { WaitlistConfirmation } from "@/emails/WaitlistConfirmation";

/**
 * Render the waitlist confirmation template to an email-ready HTML document.
 *
 * We render to a string ourselves rather than handing resend the React element
 * via its `react:` field: that path lazily `import()`s the optional
 * `@react-email/render` package, which this app does not install, so every send
 * would throw. Passing `html:` sidesteps that dependency entirely. React escapes
 * `firstName`, so untrusted input can't inject markup here.
 *
 * react-dom/server is dynamically imported to avoid Turbopack's static-analysis
 * ban on top-level imports of that module in App Router server code.
 */
async function renderWaitlistConfirmationHtml(firstName: string): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(
    React.createElement(WaitlistConfirmation, { firstName }),
  );
  return (
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
    '</head><body style="margin:0;padding:0;background-color:#ffffff;">' +
    body +
    "</body></html>"
  );
}

/**
 * Send the waitlist confirmation email. Fire-and-forget by design: the caller
 * has already persisted the signup, so a mail failure must NEVER surface to the
 * user. This never rejects — it no-ops when `RESEND_API_KEY` is unset (local dev
 * / store-only mode) and catches the synchronous resend-client construction
 * error (missing/invalid key) plus any async send rejection. It also inspects
 * the resolved `{ error }`: resend does NOT throw on API failures (a 401 from a
 * bad key, a 403 from an unverified sender domain, rate limits) — it resolves
 * with an error object — so without this check a misconfigured deploy would fail
 * silently. Everything is logged. Call without `await` (`void sendWaitlist...`).
 */
export async function sendWaitlistConfirmation(
  email: string,
  firstName: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_CONFIG.FROM,
      to: email,
      subject: EMAIL_CONFIG.SUBJECT,
      html: await renderWaitlistConfirmationHtml(firstName),
    });
    if (error) {
      console.error(`Resend rejected confirmation email to ${email}:`, error);
    }
  } catch (error) {
    console.error(`Failed to send confirmation email to ${email}:`, error);
  }
}
