/**
 * Event-related email templates. Currently: the RSVP confirmation (with an .ics
 * attachment so guests can one-tap add to their calendar). Fire-and-forget from
 * the RSVP routes; never blocks or fails an RSVP.
 */

import { sendEmail } from './send';
import { makeICS, formatEventDateRange } from '@/lib/eventUtils';
import type { NBEvent, RSVPStatus } from '@/lib/types';

function eventUrl(event: NBEvent): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || '';
  const slug = event.slug ?? event.id.replace(/^event:/, '');
  return `${base}/e/${slug}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function headline(status: RSVPStatus): { subjectPrefix: string; intro: string; attachIcs: boolean } {
  switch (status) {
    case 'waitlisted':
      return { subjectPrefix: "You're on the waitlist", intro: "You're on the waitlist — we'll email you if a spot opens up.", attachIcs: false };
    case 'pending':
      return { subjectPrefix: 'RSVP received', intro: 'Your RSVP is pending the host’s approval. We’ll let you know.', attachIcs: false };
    case 'cancelled':
      return { subjectPrefix: 'RSVP updated', intro: "Thanks for letting us know you can't make it.", attachIcs: false };
    default:
      return { subjectPrefix: "You're going", intro: "You're confirmed — see you there! Add it to your calendar below.", attachIcs: true };
  }
}

export async function sendRsvpConfirmation(
  event: NBEvent,
  to: string | undefined,
  guestName: string | undefined,
  status: RSVPStatus,
): Promise<void> {
  if (!to) return;
  const { subjectPrefix, intro, attachIcs } = headline(status);
  const when = event.startAt ? formatEventDateRange(event.startAt, event.endAt, event.timezone) : '';
  const where = event.location?.label ? escapeHtml(event.location.label) : '';
  const url = eventUrl(event);
  const hi = guestName ? `Hi ${escapeHtml(guestName.split(' ')[0])}, ` : '';

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111827">
    ${event.coverImageUrl ? `<img src="${escapeHtml(event.coverImageUrl)}" alt="" style="width:100%;border-radius:12px;margin-bottom:16px" />` : ''}
    <h1 style="font-size:22px;margin:0 0 8px">${escapeHtml(event.title)}</h1>
    <p style="font-size:15px;color:#4b5563;margin:0 0 16px">${hi}${escapeHtml(intro)}</p>
    <table style="font-size:14px;color:#111827;border-collapse:collapse">
      ${when ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">When</td><td style="padding:4px 0"><strong>${escapeHtml(when)}</strong></td></tr>` : ''}
      ${where ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Where</td><td style="padding:4px 0">${where}</td></tr>` : ''}
    </table>
    <p style="margin:20px 0">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#78d870;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">View event</a>
    </p>
    <p style="font-size:12px;color:#9ca3af;margin-top:24px">You received this because you RSVP’d on Visvine.</p>
  </div>`;

  const attachments = attachIcs
    ? [{ filename: `${event.id.replace(/^event:/, '')}.ics`, content: Buffer.from(makeICS(event)).toString('base64'), contentType: 'text/calendar' }]
    : undefined;

  await sendEmail({
    to,
    subject: `${subjectPrefix}: ${event.title}`,
    html,
    replyTo: event.organizerEmail,
    attachments,
  });
}
