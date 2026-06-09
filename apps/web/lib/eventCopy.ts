import type { RSVPStatus } from './types';

/** Friendly confirmation copy for the resulting RSVP status (shared by routes). */
export function rsvpMessage(status: RSVPStatus): string {
  switch (status) {
    case 'waitlisted': return "You're on the waitlist — we'll let you know if a spot opens up.";
    case 'pending': return 'Your RSVP is pending host approval.';
    case 'cancelled': return "Thanks for letting us know you can't make it.";
    default: return "You're going! 🎉";
  }
}
