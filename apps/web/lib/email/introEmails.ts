/**
 * Warm-introduction email templates. Fire-and-forget from the intro service;
 * every send is a silent no-op without RESEND_API_KEY (see ./send). Recipients
 * act in-app via the topbar Intros inbox, so these are notifications, not links
 * to a standalone page.
 */

import { sendEmail } from './send';

const BRAND = '#78d870';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function appUrl(path = ''): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || '';
  return `${base}${path}`;
}

function shell(opts: { heading: string; intro: string; bodyHtml?: string; ctaLabel: string; ctaPath: string }): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111827">
    <h1 style="font-size:21px;margin:0 0 8px">${escapeHtml(opts.heading)}</h1>
    <p style="font-size:15px;color:#4b5563;margin:0 0 16px">${opts.intro}</p>
    ${opts.bodyHtml ?? ''}
    <p style="margin:22px 0 4px">
      <a href="${escapeHtml(appUrl(opts.ctaPath))}" style="display:inline-block;background:${BRAND};color:#111827;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${escapeHtml(opts.ctaLabel)}</a>
    </p>
    <p style="font-size:12px;color:#9ca3af;margin-top:24px">You received this because you're on Visvine.</p>
  </div>`;
}

function quote(label: string, text: string): string {
  if (!text) return '';
  return `
    <div style="background:#f9fafb;border-radius:10px;padding:14px 16px;margin:0 0 12px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin-bottom:6px">${escapeHtml(label)}</div>
      <div style="font-size:14px;color:#374151;white-space:pre-line;line-height:1.5">${escapeHtml(text)}</div>
    </div>`;
}

/** → introducer: "X asked you to introduce them to Y". */
export async function sendIntroRequestedEmail(args: {
  to: string;
  introducerName: string;
  requesterName: string;
  targetName: string;
  message: string;
}): Promise<void> {
  await sendEmail({
    to: args.to,
    subject: `${args.requesterName} asked you for an intro to ${args.targetName}`,
    html: shell({
      heading: `Intro request from ${args.requesterName}`,
      intro: `Hi ${escapeHtml(args.introducerName.split(' ')[0])}, <strong>${escapeHtml(args.requesterName)}</strong> would like a warm introduction to <strong>${escapeHtml(args.targetName)}</strong>, who you both know.`,
      bodyHtml: quote(`Why they're asking you`, args.message),
      ctaLabel: 'Review the request',
      ctaPath: '/directory',
    }),
  });
}

/** → target, after the introducer approves: "X would like to be introduced to you". */
export async function sendIntroForwardedEmail(args: {
  to: string;
  targetName: string;
  requesterName: string;
  introducerName: string;
  endorsement: string;
  message: string;
}): Promise<void> {
  await sendEmail({
    to: args.to,
    subject: `${args.introducerName} would like to introduce you to ${args.requesterName}`,
    html: shell({
      heading: `An introduction from ${args.introducerName}`,
      intro: `Hi ${escapeHtml(args.targetName.split(' ')[0])}, <strong>${escapeHtml(args.introducerName)}</strong> would like to introduce you to <strong>${escapeHtml(args.requesterName)}</strong>. You can accept or decline in the Intros inbox.`,
      bodyHtml: quote(`${args.introducerName}'s note`, args.endorsement) + quote(`Message from ${args.requesterName}`, args.message),
      ctaLabel: 'Accept or decline',
      ctaPath: '/directory',
    }),
  });
}

/** → both parties once the target accepts. */
export async function sendIntroConnectedEmail(args: {
  to: string;
  recipientName: string;
  otherName: string;
}): Promise<void> {
  await sendEmail({
    to: args.to,
    subject: `You're now connected with ${args.otherName}`,
    html: shell({
      heading: `You're connected 🎉`,
      intro: `Hi ${escapeHtml(args.recipientName.split(' ')[0])}, you and <strong>${escapeHtml(args.otherName)}</strong> are now connected on Visvine. Say hello!`,
      ctaLabel: 'Open Visvine',
      ctaPath: '/messages',
    }),
  });
}
