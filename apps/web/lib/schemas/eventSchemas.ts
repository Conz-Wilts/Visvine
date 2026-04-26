/**
 * Zod validation schemas for Events
 */

import { z } from 'zod';

// Form field schema
export const formFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'email', 'select', 'checkbox', 'url', 'linkedin', 'company']),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
});

// Event schema
export const eventSchema = z.object({
  id: z.string().regex(/^event:.+/),
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
  hosts: z.array(z.string()),
  organizerEmail: z.string().email().optional(),
  capacity: z.number().int().positive().optional(),
  visibility: z.enum(['public', 'community', 'private']),
  form: z.object({
    enabled: z.boolean(),
    slug: z.string(),
    schema: z.array(formFieldSchema),
    domainAllowlist: z.array(z.string()).optional(),
    requireApproval: z.boolean().optional(),
  }),
  analytics: z.object({
    views: z.number().int().min(0),
    rsvpCount: z.number().int().min(0),
    checkinCount: z.number().int().min(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Attendee schema
export const attendeeSchema = z.object({
  id: z.string().regex(/^attendee:.+/),
  eventId: z.string().regex(/^event:.+/),
  personId: z.string().regex(/^person:.+/),
  email: z.string().email().optional(),
  linkedinUrl: z.string().url().optional(),
  companyName: z.string().optional(),
  roleTitle: z.string().optional(),
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  status: z.enum(['invited', 'registered', 'waitlisted', 'cancelled', 'checked_in', 'no_show']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  checkinAt: z.string().datetime().optional(),
});

// RSVP submission schema (what the user submits via the form)
export const rsvpSubmissionSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  linkedinUrl: z.string().url().optional(),
  companyName: z.string().max(200).optional(),
  roleTitle: z.string().max(200).optional(),
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

// Event creation input (before IDs are generated)
export const eventCreateInputSchema = z.object({
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
  visibility: z.enum(['public', 'community', 'private']).default('public'),
  form: z.object({
    enabled: z.boolean().default(true),
    schema: z.array(formFieldSchema).default([]),
    domainAllowlist: z.array(z.string()).optional(),
    requireApproval: z.boolean().optional(),
  }).default({
    enabled: true,
    schema: [],
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Event update input (partial)
export const eventUpdateInputSchema = eventCreateInputSchema.partial().omit({ communityId: true });

// Types inferred from schemas
export type FormFieldInput = z.infer<typeof formFieldSchema>;
export type EventInput = z.infer<typeof eventCreateInputSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateInputSchema>;
export type RSVPSubmission = z.infer<typeof rsvpSubmissionSchema>;

