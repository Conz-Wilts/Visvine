// Events domain: events, RSVP/attendee records, and registration forms.

// Event types
export type EventVisibility = 'public' | 'space' | 'private';
// Operational lifecycle; the list is held by a CHECK on event_attendees.status.
export type RSVPStatus = 'invited' | 'pending' | 'going' | 'waitlisted' | 'cancelled' | 'checked_in' | 'no_show';
// The guest's intent, independent of the operational status above.
export type RSVPResponse = 'going' | 'maybe' | 'declined';
type FormFieldType = 'text' | 'textarea' | 'email' | 'select' | 'checkbox' | 'url' | 'linkedin' | 'company';

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface NBEvent {
  id: `event:${string}`;
  spaceId: string;
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  timezone?: string;
  location?: {
    label: string;
    address?: string;
    lat?: number;
    lon?: number;
    /** The venue's id in the map service it was picked from, so a map link opens its listing. */
    placeId?: string;
  };
  hosts: string[];
  organizerEmail?: string;
  capacity?: number;
  visibility: EventVisibility;
  // rebuild additions (all stored in Node.metadata; coverImageUrl mirrors Node.imageUrl)
  coverImageUrl?: string;
  theme?: { color?: string };
  status?: 'draft' | 'published'; // undefined = legacy/published
  slug?: string; // clean public URL segment (visvine.com/e/<slug>); mirrors Node.alias
  waitlistEnabled?: boolean; // auto-on when capacity is set
  guestListVisible?: boolean; // show the guest list on the public page
  allowPlusOnes?: number; // max additional guests per RSVP (0 = none)
  allowedResponses?: RSVPResponse[]; // which RSVP buttons the host enables
  form: {
    enabled: boolean;
    slug: string;
    schema: FormField[];
    domainAllowlist?: string[];
    requireApproval?: boolean;
  };
  analytics: {
    views: number;
    rsvpCount: number;
    checkinCount: number;
    createdAt: string;
    updatedAt: string;
  };
  metadata?: Record<string, unknown>;
}

export interface NBAttendee {
  id: `attendee:${string}`;
  eventId: NBEvent['id'];
  personId: string; // 'person:...' or '' for a loginless guest with no Person node
  name?: string; // typed guest name (loginless RSVP)
  email?: string;
  linkedinUrl?: string;
  companyName?: string;
  roleTitle?: string;
  answers?: Record<string, string | boolean>;
  status: RSVPStatus;
  response?: RSVPResponse; // guest intent (going/maybe/declined)
  plusOnes?: number;
  plusOneNames?: string[];
  invitedBy?: string;
  createdAt: string;
  updatedAt: string;
  checkinAt?: string;
}

export interface EventsData {
  events: NBEvent[];
  attendees: NBAttendee[];
}
