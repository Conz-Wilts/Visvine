/**
 * Zod validation schemas for Events
 */

import { z } from 'zod';

// Form field schema
const formFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'email', 'select', 'checkbox', 'url', 'linkedin', 'company']),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
});

// Shared enums
const rsvpResponseEnum = z.enum(['going', 'maybe', 'declined']);

// Rebuild fields for eventCreateInputSchema (all optional, metadata-backed)
const eventRebuildFields = {
  coverImageUrl: z.string().optional(),
  theme: z.object({ color: z.string().optional() }).optional(),
  status: z.enum(['draft', 'published']).optional(),
  slug: z.string().max(120).optional(),
  waitlistEnabled: z.boolean().optional(),
  guestListVisible: z.boolean().optional(),
  allowPlusOnes: z.number().int().min(0).max(20).optional(),
  allowedResponses: z.array(rsvpResponseEnum).optional(),
};

// RSVP submission schema (what the guest submits via the public form)
export const rsvpSubmissionSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  linkedinUrl: z.string().url().optional(),
  companyName: z.string().max(200).optional(),
  roleTitle: z.string().max(200).optional(),
  response: rsvpResponseEnum.default('going'),
  plusOnes: z.number().int().min(0).max(20).optional(),
  plusOneNames: z.array(z.string().max(200)).optional(),
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

// Event creation input (before IDs are generated)
export const eventCreateInputSchema = z.object({
  // Optional client-generated id so a draft keeps a stable id across autosaves
  // and cover uploads. Must look like an event id; server generates one if absent.
  id: z.string().regex(/^event:.+/).optional(),
  communityId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  timezone: z.string().optional(),
  location: z.object({
    label: z.string(),
    address: z.string().optional(),
    lat: z.number().optional(),
    lon: z.number().optional(),
  }).optional(),
  hosts: z.array(z.string()).default([]),
  organizerEmail: z.union([z.string().email(), z.literal('')]).optional().transform(val => val === '' ? undefined : val),
  capacity: z.number().int().positive().optional(),
  visibility: z.enum(['public', 'community', 'private']).default('community'),
  form: z.object({
    enabled: z.boolean().default(true),
    schema: z.array(formFieldSchema).default([]),
    domainAllowlist: z.array(z.string()).optional(),
    requireApproval: z.boolean().optional(),
  }).default({
    enabled: true,
    schema: [],
  }),
  ...eventRebuildFields,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Event update input (partial; id/communityId are immutable).
//
// NOTE: `.partial()` makes the create schema's fields optional but does NOT
// suppress their `.default()`s — Zod still fires the default for an ABSENT key.
// Left as-is, an empty/sparse PATCH would silently inject hosts:[],
// visibility:'community' and an empty form, wiping host access and downgrading
// visibility on every edit. So we override the three defaulted fields with
// plain optionals (no defaults): absent keys stay absent and the PATCH merge
// only touches what the client actually sent.
export const eventUpdateInputSchema = eventCreateInputSchema
  .omit({ communityId: true, id: true })
  .partial()
  .extend({
    hosts: z.array(z.string()).optional(),
    visibility: z.enum(['public', 'community', 'private']).optional(),
    form: z
      .object({
        enabled: z.boolean().optional(),
        schema: z.array(formFieldSchema).optional(),
        domainAllowlist: z.array(z.string()).optional(),
        requireApproval: z.boolean().optional(),
      })
      .optional(),
  });

