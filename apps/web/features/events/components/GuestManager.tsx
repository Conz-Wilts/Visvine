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

import { Checkbox } from '@visvine/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import type { NBEvent, NBAttendee, RSVPStatus } from '@/lib/types';
import { useCopied } from '@/features/shared/hooks/useCopied';
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
const norm = (s: string): RSVPStatus => (s ? (s as RSVPStatus) : 'going');
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
  going: { label: 'Going', cls: 'bg-accent text-white', icon: <CheckIcon className="w-3 h-3" /> },
  waitlisted: { label: 'Waitlist', cls: 'bg-hue-orange text-white', icon: <ClockIcon className="w-3 h-3" /> },
  pending: { label: 'Pending', cls: 'bg-warning-bright text-white', icon: <ClockIcon className="w-3 h-3" /> },
  checked_in: { label: 'Checked in', cls: 'bg-accent text-white', icon: <UserCheckIcon className="w-3 h-3" /> },
  cancelled: { label: 'Cancelled', cls: 'bg-fg-muted text-white', icon: <XIcon className="w-3 h-3" /> },
  no_show: { label: 'No show', cls: 'bg-fg-muted text-white', icon: <BanIcon className="w-3 h-3" /> },
  invited: { label: 'Invited', cls: 'bg-info text-white', icon: <ClockIcon className="w-3 h-3" /> },
};

export function GuestManager({ event, spaceId }: GuestManagerProps) {
  const eventId = event.id;
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopied(2000);
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ attendees?: AttendeeRow[] }>(`/api/events/${eventId}/attendees?spaceId=${encodeURIComponent(spaceId)}`);
      setAttendees(data.attendees ?? []);
    } catch { /* the next refresh retries */ } finally {
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
    try {
      const { attendee } = await fetchJsonBody<{ attendee: Partial<AttendeeRow> }>(
        `/api/events/${eventId}/attendees/${id}?spaceId=${encodeURIComponent(spaceId)}`, 'PATCH', { action });
      setAttendees((prev) => prev.map((a) => (a.id === id ? { ...a, ...attendee } : a)));
    } catch {
      load();
    }
  };

  const remove = async (id: string) => {
    setAttendees((prev) => prev.filter((a) => a.id !== id)); // optimistic
    try {
      await fetchJson(`/api/events/${eventId}/attendees/${id}?spaceId=${encodeURIComponent(spaceId)}`, { method: 'DELETE' });
    } catch { load(); }
  };

  const bulk = async (action: string) => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await fetchJsonBody(`/api/events/${eventId}/attendees/bulk?spaceId=${encodeURIComponent(spaceId)}`, 'POST',
        { action, attendeeIds: [...selected] });
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
    void copy(`${baseUrl}/e/${slug}`);
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
        <div className="ml-auto text-sm text-fg-muted">
          {occupied}
          {event.capacity ? ` / ${event.capacity}` : ''} going
        </div>
      </div>

      {/* capacity bar */}
      {event.capacity ? (
        <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
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
                ? 'bg-accent text-white border-accent'
                : 'bg-surface-subtle text-fg-muted border-line-subtle hover:border-accent hover:text-fg'
            }`}
          >
            {f.label} <span className="opacity-70">({counts[f.key]})</span>
          </button>
        ))}
      </div>

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-lg bg-surface-subtle">
          <span className="text-sm font-medium text-fg">{selected.size} selected</span>
          <button onClick={() => bulk('approve')} disabled={busy} className={bulkBtn}><CircleCheckIcon className="w-4 h-4" /> Approve</button>
          <button onClick={() => bulk('promote')} disabled={busy} className={bulkBtn}><CircleArrowUpIcon className="w-4 h-4" /> Promote</button>
          <button onClick={() => bulk('checkin')} disabled={busy} className={bulkBtn}><UserCheckIcon className="w-4 h-4" /> Check in</button>
          <button onClick={() => bulk('remove')} disabled={busy} className={`${bulkBtn} text-danger`}><XIcon className="w-4 h-4" /> Remove</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-fg-muted hover:text-fg"><ChevronUpIcon className="w-4 h-4" /></button>
        </div>
      )}

      {/* list */}
      <div className="border-t border-line-subtle">
        {loading ? (
          <div className="py-16 flex items-center justify-center text-fg-muted"><LoaderCircleIcon className="w-5 h-5 animate-spin" /></div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-fg-muted flex flex-col items-center gap-2">
            <UsersIcon className="w-7 h-7 opacity-50" />
            No guests {filter !== 'all' ? 'in this view' : 'yet'}.
          </div>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {visible.map((a) => {
              const status = norm(a.status);
              const badge = STATUS_BADGE[status];
              const details = guestDetails(a);
              const isOpen = expanded.has(a.id);
              return (
                <li key={a.id} className="hover:bg-accent-soft/40 transition-colors">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Checkbox
                      checked={selected.has(a.id)}
                      onChange={() => toggleSel(a.id)}
                      aria-label={`Select ${a.name || a.email || 'guest'}`}
                    />
                    <div
                      className={`min-w-0 flex-1 ${details.length > 0 ? 'cursor-pointer' : ''}`}
                      onClick={details.length > 0 ? () => toggleExpand(a.id) : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-fg truncate">{a.name || a.email || 'Guest'}</span>
                        {a.response === 'maybe' && <span className="text-xs text-warning font-medium">Maybe</span>}
                        {(a.plusOnes ?? 0) > 0 && <span className="text-xs text-fg-muted">+{a.plusOnes}</span>}
                      </div>
                      <div className="text-xs text-fg-muted truncate">
                        {[a.email, a.companyName].filter(Boolean).join(' · ') || '—'}
                        {details.length > 0 && (
                          <span className="ml-1.5 text-accent font-medium">
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
                          <dt className="inline text-fg-muted">{d.label}: </dt>
                          <dd className="inline text-fg break-words">{d.value}</dd>
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
      {status === 'pending' && <IconBtn title="Approve" onClick={() => onAct('approve')}><CheckIcon className="w-4 h-4 text-accent" /></IconBtn>}
      {status === 'waitlisted' && <IconBtn title="Promote" onClick={() => onAct('promote')}><CircleArrowUpIcon className="w-4 h-4 text-accent" /></IconBtn>}
      {(status === 'going') && <IconBtn title="Check in" onClick={() => onAct('checkin')}><UserCheckIcon className="w-4 h-4 text-accent" /></IconBtn>}
      {status === 'checked_in' && <IconBtn title="Undo check-in" onClick={() => onAct('uncheckin')}><UserCheckIcon className="w-4 h-4 text-fg-muted" /></IconBtn>}
      {status !== 'cancelled' && status !== 'waitlisted' && (
        <IconBtn title="Move to waitlist" onClick={() => onAct('waitlist')}><ClockIcon className="w-4 h-4 text-fg-muted" /></IconBtn>
      )}
      <IconBtn title="Remove" onClick={onRemove}><XIcon className="w-4 h-4 text-danger-bright" /></IconBtn>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="p-1.5 rounded-lg hover:bg-surface-muted transition-colors">
      {children}
    </button>
  );
}

const actionBtn =
  'inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-fg bg-surface-subtle border border-line-subtle rounded-lg hover:border-accent hover:bg-accent-soft transition-all';
const bulkBtn =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-fg bg-surface-subtle border border-line-subtle rounded-lg hover:border-accent transition-all disabled:opacity-50';
