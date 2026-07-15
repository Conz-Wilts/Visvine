/**
 * Minimal transactional email via Resend's REST API (no SDK dependency).
 *
 * Configuration is optional: without RESEND_API_KEY every send is a silent
 * no-op (returns false), exactly like web-push without VAPID keys — so the rest
 * of the product works unconfigured. Set RESEND_API_KEY and EMAIL_FROM (a
 * verified sender, e.g. "Visvine <events@yourdomain>") to actually deliver.
 */

import { logger } from '@/lib/logger';

interface EmailAttachment {
  filename: string;
  /** base64-encoded file content */
  content: string;
  contentType?: string;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export async function sendEmail(args: SendEmailArgs): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.info('email.skipped.no_key', { to: args.to, subject: args.subject });
    return false;
  }
  const from = process.env.EMAIL_FROM || 'Visvine Events <events@visvine.com>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
        ...(args.attachments?.length
          ? { attachments: args.attachments.map((a) => ({ filename: a.filename, content: a.content })) }
          : {}),
      }),
    });
    if (!res.ok) {
      // Resend returns 200 on success; surface API errors (bad key, unverified domain) instead of swallowing them.
      logger.error('email.send.failed', { status: res.status, body: await res.text().catch(() => '') });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('email.send.error', { err });
    return false;
  }
}
