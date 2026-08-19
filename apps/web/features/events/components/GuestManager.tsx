'use client';

/**
 * GuestManager — the host's actionable guest console (replaces the read-only
 * AttendeesTable for hosts). Segmented status filters with live counts, a
 * capacity bar, inline per-row actions, bulk actions, check-in, CSV export, and
 * a copyable public RSVP link. Optimistic updates + a 15s background refresh.
 *
 * Self-contained: fetches the host-only attendees endpoint and mutates via the
 * attendee PATCH/DELETE/bulk routes. Host/admin gating is enforced server-side.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NBEvent, NBAttendee, RSVPStatus } from '@/lib/types';
import { copyToClipboard } from '@/lib/utils';
import { BanIcon, CheckIcon, ChevronUpIcon, CircleArrowUpIcon, CircleCheckIcon, ClockIcon, FileDownIcon, Link2Icon, LoaderCircleIcon, RefreshCwIcon, UserCheckIcon, UsersIcon, XIcon } from '@/features/shared/icons';

interface AttendeeRow extends NBAttendee {
  name?: string;
  image_url?: string;
  person?: { id: string; name: string; subtitle?: string; tags?: string[] } | null;
}

interface GuestManagerProps {
  event: NBEvent;
  spaceId: string;
}

// Client-safe status helpers (kept local to avoid importing node `crypto` via eventUtils).
const norm = (s: string): RSVPStatus => (!s || s === 'registered' ? 'going' : (s as RSVPStatus));
const spots = (a: AttendeeRow) =>
  a.response === 'maybe' ? 0 : (['going', 'checked_in'].includes(norm(a.status)) ? 1 + (a.plusOnes ?? 0) : 0);

type FilterKey = 'all' | 'going' | 'maybe' | 'waitlisted' | 'pending' | 'checked_in';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'going', label: 'Going' },
  { key: 'maybe', label: 'Maybe' },
  { key: 'waitlisted', label: 'Waitlist' },
  { key: 'pending', label: 'Pending' },
  { key: 'checked_in', label: 'Checked in' },
];

function matchesFilter(a: AttendeeRow, f: FilterKey): boolean {
  if (f === 'all') return norm(a.status) !== 'cancelled';
  if (f === 'maybe') return a.response === 'maybe' && norm(a.status) !== 'cancelled';
  if (f === 'going') return norm(a.status) === 'going' && a.response !== 'maybe';
  return norm(a.status) === f;
}

const STATUS_BADGE: Partial<Record<RSVPStatus, { label: string; cls: string; icon: React.ReactNode }>> = {
  going: { label: 'Going', cls: 'bg-brand-green text-white', icon: <CheckIcon className="w-3 h-3" /> },
  waitlisted: { label: 'Waitlist', cls: 'bg-orange-500 text-white', icon: <ClockIcon className="w-3 h-3" /> },
  pending: { label: 'Pending', cls: 'bg-amber-500 text-white', icon: <ClockIcon className="w-3 h-3" /> },
  checked_in: { label: 'Checked in', cls: 'bg-brand-green text-white', icon: <UserCheckIcon className="w-3 h-3" /> },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-500 text-white', icon: <XIcon className="w-3 h-3" /> },
  no_show: { label: 'No show', cls: 'bg-gray-500 text-white', icon: <BanIcon className="w-3 h-3" /> },
  invited: { label: 'Invited', cls: 'bg-blue-600 text-white', icon: <ClockIcon className="w-3 h-3" /> },
};

export function GuestManager({ event, spaceId }: GuestManagerProps) {
  const eventId = event.id;
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/attendees?spaceId=${encodeURIComponent(spaceId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setAttendees(data.attendees ?? []);
    } finally {
      setLoading(false);
    }
  }, [eventId, spaceId]);

  useEffect(() => {
    load();
  }, [load]);

  // background refresh while the tab is open — paused while hidden, with one
  // immediate catch-up reload when the tab becomes visible again.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadRef.current();
    }, 15_000);
    const onVis = () => { if (document.visibilityState === 'visible') void loadRef.current(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, going: 0, maybe: 0, waitlisted: 0, pending: 0, checked_in: 0 };
    for (const f of FILTERS) c[f.key] = attendees.filter((a) => matchesFilter(a, f.key)).length;
    return c;
  }, [attendees]);

  const occupied = useMemo(() => attendees.reduce((s, a) => s + spots(a), 0), [attendees]);

  const visible = useMemo(
    () => attendees.filter((a) => matchesFilter(a, filter)).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [attendees, filter],
  );

  const act = async (id: string, action: string) => {
    const res = await fetch(`/api/events/${eventId}/attendees/${id}?spaceId=${encodeURIComponent(spaceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      const { attendee } = await res.json();
      setAttendees((prev) => prev.map((a) => (a.id === id ? { ...a, ...attendee } : a)));
    } else {
      load();
    }
  };

  const remove = async (id: string) => {
    setAttendees((prev) => prev.filter((a) => a.id !== id)); // optimistic
    const res = await fetch(`/api/events/${eventId}/attendees/${id}?spaceId=${encodeURIComponent(spaceId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) load();
  };

  const bulk = async (action: string) => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await fetch(`/api/events/${eventId}/attendees/bulk?spaceId=${encodeURIComponent(spaceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, attendeeIds: [...selected] }),
      });
      setSelected(new Set());
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Registration answers (labelled via the event's question schema) plus the
  // extra profile fields not shown on the row itself.
  const guestDetails = useCallback(
    (a: AttendeeRow): { label: string; value: string }[] => {
      const fmt = (v: string | boolean) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v);
      const ans = a.answers ?? {};
      const schema = event.form?.schema ?? [];
      const details: { label: string; value: string }[] = [];
      for (const f of schema) {
        const v = ans[f.id];
        if (v !== undefined && v !== '') details.push({ label: f.label, value: fmt(v) });
      }
      // answers to questions the host has since removed from the form
      for (const [k, v] of Object.entries(ans)) {
        if (v !== '' && !schema.some((f) => f.id === k)) details.push({ label: k, value: fmt(v) });
      }
      if (a.roleTitle) details.push({ label: 'Role', value: a.roleTitle });
      if (a.linkedinUrl) details.push({ label: 'LinkedIn', value: a.linkedinUrl });
      return details;
    },
    [event.form?.schema],
  );

  const copyLink = async () => {
    const slug = event.slug ?? eventId.replace(/^event:/, '');
    if (await copyToClipboard(`${baseUrl}/e/${slug}`)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-5">
      {/* action row */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button onClick={copyLink} className={actionBtn}>
          {copied ? <CheckIcon className="w-4 h-4" /> : <Link2Icon className="w-4 h-4" />}
          {copied ? 'Copied' : 'Invite link'}
        </button>
        <a
          href={`/api/events/${eventId}/export.csv?spaceId=${encodeURIComponent(spaceId)}`}
          target="_blank"
          rel="noreferrer"
          className={actionBtn}
        >
          <FileDownIcon className="w-4 h-4" /> Export CSV
        </a>
        <button onClick={() => load()} className={actionBtn}>
          <RefreshCwIcon className="w-4 h-4" /> Refresh
        </button>
        <div className="ml-auto text-sm text-brand-grey">
          {occupied}
          {event.capacity ? ` / ${event.capacity}` : ''} going
        </div>
      </div>

      {/* capacity bar */}
      {event.capacity ? (
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-brand-green transition-all"
            style={{ width: `${Math.min(100, (occupied / event.capacity) * 100)}%` }}
          />
        </div>
      ) : null}

      {/* filters */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              filter === f.key
                ? 'bg-brand-green text-white border-brand-green'
                : 'bg-brand-white text-brand-grey border-gray-200 hover:border-brand-green hover:text-brand-black'
            }`}
          >
            {f.label} <span className="opacity-70">({counts[f.key]})</span>
          </button>
        ))}
      </div>

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-brand-light-bg border border-brand-green/30">
          <span className="text-sm font-medium text-brand-black">{selected.size} selected</span>
          <button onClick={() => bulk('approve')} disabled={busy} className={bulkBtn}><CircleCheckIcon className="w-4 h-4" /> Approve</button>
          <button onClick={() => bulk('promote')} disabled={busy} className={bulkBtn}><CircleArrowUpIcon className="w-4 h-4" /> Promote</button>
          <button onClick={() => bulk('checkin')} disabled={busy} className={bulkBtn}><UserCheckIcon className="w-4 h-4" /> Check in</button>
          <button onClick={() => bulk('remove')} disabled={busy} className={`${bulkBtn} text-red-600`}><XIcon className="w-4 h-4" /> Remove</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-brand-grey hover:text-brand-black"><ChevronUpIcon className="w-4 h-4" /></button>
        </div>
      )}

      {/* list */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center text-brand-grey"><LoaderCircleIcon className="w-5 h-5 animate-spin" /></div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-brand-grey flex flex-col items-center gap-2">
            <UsersIcon className="w-7 h-7 opacity-50" />
            No guests {filter !== 'all' ? 'in this view' : 'yet'}.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visible.map((a) => {
              const status = norm(a.status);
              const badge = STATUS_BADGE[status];
              const details = guestDetails(a);
              const isOpen = expanded.has(a.id);
              return (
                <li key={a.id} className="hover:bg-brand-light-bg/40 transition-colors">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSel(a.id)}
                      className="w-4 h-4 rounded border-gray-300 text-brand-green focus:ring-brand-green"
                    />
                    <div
                      className={`min-w-0 flex-1 ${details.length > 0 ? 'cursor-pointer' : ''}`}
                      onClick={details.length > 0 ? () => toggleExpand(a.id) : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-brand-black truncate">{a.name || a.email || 'Guest'}</span>
                        {a.response === 'maybe' && <span className="text-xs text-amber-600 font-medium">Maybe</span>}
                        {(a.plusOnes ?? 0) > 0 && <span className="text-xs text-brand-grey">+{a.plusOnes}</span>}
                      </div>
                      <div className="text-xs text-brand-grey truncate">
                        {[a.email, a.companyName].filter(Boolean).join(' · ') || '—'}
                        {details.length > 0 && (
                          <span className="ml-1.5 text-brand-green font-medium">
                            · {details.length} {details.length === 1 ? 'answer' : 'answers'} {isOpen ? '▴' : '▾'}
                          </span>
                        )}
                      </div>
                    </div>
                    {badge && (
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${badge.cls}`}>
                        {badge.icon}
                        {badge.label}
                      </span>
                    )}
                    <RowActions status={status} onAct={(action) => act(a.id, action)} onRemove={() => remove(a.id)} />
                  </div>
                  {isOpen && details.length > 0 && (
                    <dl className="px-4 pb-3 pl-11 space-y-1">
                      {details.map((d) => (
                        <div key={d.label} className="text-xs">
                          <dt className="inline text-brand-grey">{d.label}: </dt>
                          <dd className="inline text-brand-black break-words">{d.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function RowActions({
  status, onAct, onRemove,
}: { status: RSVPStatus; onAct: (action: string) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1">
      {status === 'pending' && <IconBtn title="Approve" onClick={() => onAct('approve')}><CheckIcon className="w-4 h-4 text-brand-green" /></IconBtn>}
      {status === 'waitlisted' && <IconBtn title="Promote" onClick={() => onAct('promote')}><CircleArrowUpIcon className="w-4 h-4 text-brand-green" /></IconBtn>}
      {(status === 'going') && <IconBtn title="Check in" onClick={() => onAct('checkin')}><UserCheckIcon className="w-4 h-4 text-brand-green" /></IconBtn>}
      {status === 'checked_in' && <IconBtn title="Undo check-in" onClick={() => onAct('uncheckin')}><UserCheckIcon className="w-4 h-4 text-brand-grey" /></IconBtn>}
      {status !== 'cancelled' && status !== 'waitlisted' && (
        <IconBtn title="Move to waitlist" onClick={() => onAct('waitlist')}><ClockIcon className="w-4 h-4 text-brand-grey" /></IconBtn>
      )}
      <IconBtn title="Remove" onClick={onRemove}><XIcon className="w-4 h-4 text-red-500" /></IconBtn>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
      {children}
    </button>
  );
}

const actionBtn =
  'inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green hover:bg-brand-light-bg transition-all';
const bulkBtn =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green transition-all disabled:opacity-50';
