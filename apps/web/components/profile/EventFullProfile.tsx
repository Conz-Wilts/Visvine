'use client';

import React from 'react';
import {
  MapPin, Mail, Users, Share2, Copy, ExternalLink, X, ChevronRight, CheckCircle2,
} from 'lucide-react';
import type { NBNode } from '@/lib/types';
import { useEventDetails } from '@/hooks/useEventDetails';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { formatEventDateShort, getEventStatus, formatEventTime } from '@/lib/eventUtils';

interface EventFullProfileProps {
  nodeId: string;
  node?: NBNode;
  onClose: () => void;
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function formatDayTime(startAt: string, endAt?: string) {
  const start = new Date(startAt);
  const day = start.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
  const startT = formatEventTime(startAt);
  const endT = endAt ? formatEventTime(endAt) : null;
  return { day, time: endT ? `${startT} – ${endT}` : startT };
}

export default function EventFullProfile({ nodeId, node: initialNode, onClose }: EventFullProfileProps) {
  const { data: nodeData } = useNodeProfile(nodeId);
  const node = nodeData?.node ?? initialNode;
  const communityId = node?.community_id ?? '';
  const { data: eventData } = useEventDetails(nodeId, communityId || null);

  const meta = node?.metadata ?? {};
  const startAt = (meta.start_at ?? meta.startAt) as string | undefined;
  const endAt = (meta.end_at ?? meta.endAt) as string | undefined;
  const description = (meta.description ?? node?.subtitle) as string | undefined;
  const organizerEmail = meta.organizerEmail as string | undefined;
  const capacity = meta.capacity as number | undefined;
  const hosts = (meta.hosts as string[] | undefined) ?? [];
  const visibility = (meta.visibility as string | undefined) ?? 'public';
  const location = node?.location ?? (meta.locationData as { label?: string } | undefined)?.label;
  const coverUrl = (meta.coverImageUrl as string | undefined) ?? node?.image_url ?? undefined;

  const status = startAt ? getEventStatus(startAt, endAt) : 'upcoming';
  const dateBadge = startAt ? formatEventDateShort(startAt) : null;
  const dayTime = startAt ? formatDayTime(startAt, endAt) : null;
  const isPrivate = visibility === 'private' || visibility === 'community';
  const stats = eventData?.stats;

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href);
  }

  if (!node) {
    return (
      <div className="relative bg-surface-1 rounded-2xl border border-border-subtle overflow-hidden" style={{ minHeight: 'calc(100vh - 4rem)' }}>
        <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 rounded-xl text-text-muted hover:bg-surface-2"><X className="w-5 h-5" /></button>
        <div className="flex items-center justify-center h-96">
          <div className="w-6 h-6 border-2 border-border-subtle border-t-text-muted rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative bg-surface-1 rounded-2xl border border-border-subtle overflow-hidden"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)', minHeight: 'calc(100vh - 4rem)' }}
    >
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-surface-1 border-b border-border-subtle flex items-center justify-between px-5 h-12">
        <div className="flex items-center gap-1">
          <button onClick={handleCopy} className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium text-text-secondary hover:bg-surface-2">
            <Copy className="w-3.5 h-3.5" /> Copy Link
          </button>
          <a href={`/events/${node.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium text-text-secondary hover:bg-surface-2">
            Event Page <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-2 rounded-xl text-text-muted hover:bg-surface-2">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-10 px-6 lg:px-10 py-8 max-w-6xl mx-auto">
        {/* ── Left column: poster + hosts ── */}
        <div className="space-y-6">
          <div className="aspect-square w-full rounded-2xl overflow-hidden bg-gradient-to-br from-slate-800 to-slate-600 relative">
            {coverUrl ? (
              <img src={coverUrl} alt={node.name} className="w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-white/90 px-6 text-center">
                <div>
                  <div className="text-3xl font-bold tracking-wide">{node.name}</div>
                  {dayTime && <div className="mt-2 text-sm opacity-80">{dayTime.day}</div>}
                </div>
              </div>
            )}
          </div>

          {hosts.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Presented by</p>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-surface-2 border border-border-subtle">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold bg-brand-green text-white">
                  {getInitials(hosts[0])}
                </div>
                <span className="text-sm font-medium text-text-primary">{hosts[0]}</span>
              </div>
            </div>
          )}

          {hosts.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Hosted By</p>
              <div className="space-y-2">
                {hosts.map((h, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold bg-surface-3 text-text-secondary">
                      {getInitials(h)}
                    </div>
                    <span className="text-sm text-text-primary">{h}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-1">
                <button className="text-xs text-text-muted hover:text-text-primary block">Contact the Host</button>
                <button className="text-xs text-text-muted hover:text-text-primary block">Report Event</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Right column: details ── */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ${
              isPrivate ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isPrivate ? 'bg-purple-500' : 'bg-blue-500'}`} />
              {isPrivate ? 'Private Event' : 'Public Event'}
            </span>
          </div>

          <h1 className="text-4xl font-bold text-text-primary leading-tight tracking-tight">{node.name}</h1>

          {hosts[0] && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-border-subtle w-fit">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold bg-brand-green text-white">
                {getInitials(hosts[0])}
              </div>
              <span className="text-sm font-medium text-text-primary">{hosts[0]}</span>
            </div>
          )}

          <div className="space-y-3">
            {dayTime && dateBadge && (
              <div className="flex items-center gap-4 p-1">
                <div className="w-12 flex-shrink-0 rounded-lg border border-border-subtle overflow-hidden text-center">
                  <div className="text-[10px] font-bold text-text-muted py-0.5 bg-surface-2">{dateBadge.month}</div>
                  <div className="text-lg font-bold text-text-primary py-0.5">{dateBadge.day}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-text-primary">{dayTime.day}</div>
                  <div className="text-sm text-text-muted">{dayTime.time}</div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 p-1">
              <div className="w-12 h-12 flex-shrink-0 rounded-lg border border-border-subtle bg-surface-2 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-text-muted" />
              </div>
              <div>
                <div className="text-sm font-semibold text-text-primary">{location ?? 'To Be Announced'}</div>
                {location && <div className="text-sm text-text-muted">Venue details shared with attendees</div>}
              </div>
            </div>
          </div>

          {/* RSVP status card */}
          <div className="rounded-2xl border border-border-subtle bg-surface-2 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-brand-green flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-white" />
                </span>
                <span className="text-sm font-semibold text-text-primary">Registration</span>
              </div>
              {status === 'live' && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
                </span>
              )}
            </div>
            <div className="px-4 py-4 space-y-3">
              <h3 className="text-lg font-semibold text-text-primary">
                {status === 'past' ? 'This event has ended' : 'RSVP to attend'}
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {status === 'past'
                  ? 'Registration is closed. Check back for the next one.'
                  : 'Secure your spot. The host will confirm your registration.'}
              </p>
              {status !== 'past' && (
                <button className="w-full h-10 rounded-xl bg-brand-green text-white text-sm font-semibold hover:opacity-90 transition-opacity">
                  Request to Join
                </button>
              )}
              <div className="flex items-center gap-4 text-xs text-text-muted pt-1">
                {capacity && <span>Capacity: <span className="font-semibold text-text-secondary">{capacity}</span></span>}
                {stats && <span>Registered: <span className="font-semibold text-text-secondary">{stats.registered}</span></span>}
              </div>
            </div>
          </div>

          {/* Get Ready card */}
          <div className="rounded-2xl border border-border-subtle bg-surface-1 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary">Get Ready for the Event</p>
              <p className="text-xs text-text-muted mt-0.5">Profile Complete · Reminder: Email</p>
            </div>
            <ChevronRight className="w-5 h-5 text-text-muted" />
          </div>

          {/* About */}
          {description && (
            <div className="pt-2">
              <h2 className="text-lg font-semibold text-text-primary mb-3">About Event</h2>
              <div className="prose prose-sm max-w-none text-text-secondary whitespace-pre-line leading-relaxed">
                {description}
              </div>
            </div>
          )}

          {/* Contact / share actions */}
          <div className="flex items-center gap-3 pt-4 border-t border-border-subtle">
            <button onClick={handleCopy} className="flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium text-text-secondary border border-border-subtle hover:bg-surface-2">
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
            {organizerEmail && (
              <a href={`mailto:${organizerEmail}`} className="flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium text-text-secondary border border-border-subtle hover:bg-surface-2">
                <Mail className="w-3.5 h-3.5" /> Contact Host
              </a>
            )}
            {stats && stats.total > 0 && (
              <span className="flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium text-text-muted">
                <Users className="w-3.5 h-3.5" /> {stats.total} attending
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
