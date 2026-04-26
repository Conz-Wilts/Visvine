'use client';

import React from 'react';
import {
  MapPin, Mail, Users, Copy, ExternalLink, ChevronRight, CheckCircle2,
} from 'lucide-react';
import type { NBNode, NBLink } from '@/lib/types';
import type { ThemePalette } from '@/lib/profileTheme';
import { useEventDetails } from '@/hooks/useEventDetails';
import { formatEventDateShort, getEventStatus, formatEventTime } from '@/lib/eventUtils';

interface EventSidebarContentProps {
  displayNode: NBNode;
  allLinks: NBLink[];
  allNodes: NBNode[];
  theme: ThemePalette;
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

export default function EventSidebarContent({ displayNode }: EventSidebarContentProps) {
  const meta = displayNode.metadata ?? {};
  const communityId = displayNode.community_id ?? '';
  const { data: eventData } = useEventDetails(displayNode.id, communityId || null);

  const startAt = (meta.start_at ?? meta.startAt) as string | undefined;
  const endAt = (meta.end_at ?? meta.endAt) as string | undefined;
  const description = (meta.description ?? displayNode.subtitle) as string | undefined;
  const organizerEmail = meta.organizerEmail as string | undefined;
  const capacity = meta.capacity as number | undefined;
  const hosts = (meta.hosts as string[] | undefined) ?? [];
  const visibility = (meta.visibility as string | undefined) ?? 'public';
  const location = displayNode.location ?? (meta.locationData as { label?: string } | undefined)?.label;
  const coverUrl = (meta.coverImageUrl as string | undefined) ?? displayNode.image_url ?? undefined;

  const status = startAt ? getEventStatus(startAt, endAt) : 'upcoming';
  const dateBadge = startAt ? formatEventDateShort(startAt) : null;
  const dayTime = startAt ? formatDayTime(startAt, endAt) : null;
  const isPrivate = visibility === 'private' || visibility === 'community';
  const stats = eventData?.stats;

  function handleCopy() {
    navigator.clipboard.writeText(`${window.location.origin}/events/${displayNode.id}`);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Action bar */}
      <div className="flex items-center gap-1 -mt-1">
        <button onClick={handleCopy} className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium text-text-secondary hover:bg-surface-2">
          <Copy className="w-3.5 h-3.5" /> Copy Link
        </button>
        <a href={`/events/${displayNode.id}`} className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium text-text-secondary hover:bg-surface-2">
          Event Page <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Poster */}
      <div className="aspect-square w-full rounded-2xl overflow-hidden bg-gradient-to-br from-slate-800 to-slate-600 relative">
        {coverUrl ? (
          <img src={coverUrl} alt={displayNode.name} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white px-5 text-center">
            <div>
              <div className="text-xl font-bold tracking-wide">{displayNode.name}</div>
              {dayTime && <div className="mt-1.5 text-xs opacity-80">{dayTime.day}</div>}
            </div>
          </div>
        )}
      </div>

      {/* Visibility pill */}
      <div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ${
          isPrivate ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isPrivate ? 'bg-purple-500' : 'bg-blue-500'}`} />
          {isPrivate ? 'Private Event' : 'Public Event'}
        </span>
      </div>

      {/* Title */}
      <h1 className="text-2xl font-bold text-text-primary leading-tight tracking-tight -mt-1">
        {displayNode.name}
      </h1>

      {/* Host pill */}
      {hosts[0] && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-border-subtle w-fit">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold bg-brand-green text-white">
            {getInitials(hosts[0])}
          </div>
          <span className="text-sm font-medium text-text-primary">{hosts[0]}</span>
        </div>
      )}

      {/* Date + location rows */}
      <div className="grid grid-cols-1 gap-2">
        {dayTime && dateBadge && (
          <div className="flex items-center gap-3">
            <div className="w-11 flex-shrink-0 rounded-lg border border-border-subtle overflow-hidden text-center">
              <div className="text-[10px] font-bold text-text-muted py-0.5 bg-surface-2">{dateBadge.month}</div>
              <div className="text-base font-bold text-text-primary py-0.5">{dateBadge.day}</div>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-primary truncate">{dayTime.day}</div>
              <div className="text-xs text-text-muted">{dayTime.time}</div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 flex-shrink-0 rounded-lg border border-border-subtle bg-surface-2 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-text-muted" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary truncate">{location ?? 'To Be Announced'}</div>
            {location && <div className="text-xs text-text-muted truncate">Venue details shared with attendees</div>}
          </div>
        </div>
      </div>

      {/* Registration card */}
      <div className="rounded-2xl border border-border-subtle bg-surface-2 overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-brand-green flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5 text-white" />
            </span>
            <span className="text-xs font-semibold text-text-primary">Registration</span>
          </div>
          {status === 'live' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> LIVE
            </span>
          )}
        </div>
        <div className="px-3.5 py-3.5 space-y-2.5">
          <h3 className="text-base font-semibold text-text-primary">
            {status === 'past' ? 'This event has ended' : 'RSVP to attend'}
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            {status === 'past'
              ? 'Registration is closed.'
              : 'The host will confirm your registration.'}
          </p>
          {status !== 'past' && (
            <button className="w-full h-9 rounded-xl bg-brand-green text-white text-sm font-semibold hover:opacity-90">
              Request to Join
            </button>
          )}
          {(capacity || stats) && (
            <div className="flex items-center gap-3 text-[11px] text-text-muted pt-0.5">
              {capacity && <span>Capacity: <span className="font-semibold text-text-secondary">{capacity}</span></span>}
              {stats && <span>Registered: <span className="font-semibold text-text-secondary">{stats.registered}</span></span>}
            </div>
          )}
        </div>
      </div>

      {/* Get Ready */}
      <div className="rounded-xl border border-border-subtle bg-surface-1 px-3.5 py-2.5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-text-primary">Get Ready for the Event</p>
          <p className="text-[11px] text-text-muted mt-0.5">Profile Complete · Reminder: Email</p>
        </div>
        <ChevronRight className="w-4 h-4 text-text-muted" />
      </div>

      {/* About */}
      {description && (
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-2">About Event</h2>
          <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">
            {description}
          </p>
        </div>
      )}

      {/* Footer actions */}
      {(organizerEmail || (stats && stats.total > 0)) && (
        <div className="flex items-center gap-2 pt-3 border-t border-border-subtle">
          {organizerEmail && (
            <a href={`mailto:${organizerEmail}`} className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-medium text-text-secondary border border-border-subtle hover:bg-surface-2">
              <Mail className="w-3 h-3" /> Contact
            </a>
          )}
          {stats && stats.total > 0 && (
            <span className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-medium text-text-muted">
              <Users className="w-3 h-3" /> {stats.total} attending
            </span>
          )}
        </div>
      )}
    </div>
  );
}
