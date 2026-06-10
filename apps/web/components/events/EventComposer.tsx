'use client';

/**
 * EventComposer — a single-screen, poster-first event creator (replaces the old
 * collapsible EventForm). Four things are needed to publish: cover, title,
 * date/time, location. Everything else lives behind one "More options" toggle,
 * pre-defaulted so it can be skipped. The draft autosaves; "Publish" opens a
 * share sheet (copy link + add to calendar) — the share moment is the reward.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { uploadImage, validateImageFile } from '@/lib/imageUpload';
import { copyToClipboard } from '@/lib/utils';
import type { NBEvent, EventVisibility } from '@/lib/types';
import { CustomDateTimePicker } from './CustomDateTimePicker';
import { LocationAutocomplete } from './LocationAutocomplete';
import {
  Loader2, ImagePlus, MapPin, Video, Globe, Users, Lock, ChevronDown, ChevronUp,
  Check, Link2, CalendarPlus, ExternalLink, ArrowLeft, X, Sparkles,
} from 'lucide-react';

type EventType = 'in-person' | 'virtual' | 'hybrid';

interface EventComposerProps {
  communityId: string;
  mode?: 'create' | 'edit';
  initialEvent?: NBEvent;
}

const THEME_COLORS = ['#78d870', '#2563eb', '#9333ea', '#ef4444', '#f59e0b', '#0ea5e9', '#ec4899', '#111827'];

const VISIBILITY_OPTIONS: { value: EventVisibility; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'community', label: 'Community', icon: <Users className="w-4 h-4" />, description: 'Members of this community' },
  { value: 'public', label: 'Public link', icon: <Globe className="w-4 h-4" />, description: 'Anyone with the link can RSVP' },
  { value: 'private', label: 'Unlisted', icon: <Lock className="w-4 h-4" />, description: 'Only people you invite' },
];

function inputClass() {
  return 'w-full px-4 py-3 border border-gray-200 rounded-xl bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green transition-all';
}

function makeDraftId(): `event:${string}` {
  const rnd =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `event:${rnd}`;
}

function nextTopOfHourIso(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

function plusHoursIso(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3600_000).toISOString();
}

export function EventComposer({ communityId, mode = 'create', initialEvent }: EventComposerProps) {
  const router = useRouter();
  const draftIdRef = useRef<`event:${string}`>(initialEvent?.id ?? makeDraftId());
  const createdRef = useRef(mode === 'edit');

  const initialType = (initialEvent?.metadata?.eventType as EventType) ?? 'in-person';
  // Preserve the loaded status on edit so an autosave can't unpublish the event;
  // a brand-new draft starts unpublished. "Publish" overrides this explicitly.
  const initialStatus = initialEvent?.status;

  // ── form state ──────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(initialEvent?.title ?? '');
  const [description, setDescription] = useState(initialEvent?.description ?? '');
  const [startAt, setStartAt] = useState(initialEvent?.startAt || nextTopOfHourIso());
  const [endAt, setEndAt] = useState(initialEvent?.endAt || plusHoursIso(initialEvent?.startAt || nextTopOfHourIso(), 1));
  const [timezone] = useState(initialEvent?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [eventType, setEventType] = useState<EventType>(initialType);
  const [virtualLink, setVirtualLink] = useState((initialEvent?.metadata?.virtualLink as string) ?? '');
  const [location, setLocation] = useState(initialEvent?.location ?? { label: '' });
  const [coverImageUrl, setCoverImageUrl] = useState(initialEvent?.coverImageUrl ?? '');
  const [themeColor, setThemeColor] = useState(initialEvent?.theme?.color ?? THEME_COLORS[0]);
  const [visibility, setVisibility] = useState<EventVisibility>(initialEvent?.visibility ?? 'community');
  const [capacity, setCapacity] = useState<number | undefined>(initialEvent?.capacity);
  const [requireApproval, setRequireApproval] = useState(initialEvent?.form?.requireApproval ?? false);
  const [guestListVisible, setGuestListVisible] = useState(initialEvent?.guestListVisible ?? true);
  const [allowPlusOnes, setAllowPlusOnes] = useState(initialEvent?.allowPlusOnes ?? 0);
  const [allowMaybe, setAllowMaybe] = useState(initialEvent?.allowedResponses ? initialEvent.allowedResponses.includes('maybe') : true);

  // ── ui state ────────────────────────────────────────────────────────────────
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareEvent, setShareEvent] = useState<NBEvent | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildBody = useCallback(
    (overrides: Record<string, unknown> = {}) => ({
      id: draftIdRef.current,
      communityId,
      title: title.trim() || 'Untitled event',
      description: description.trim() || undefined,
      startAt,
      endAt: endAt || undefined,
      timezone: timezone || undefined,
      location: location.label ? location : undefined,
      capacity: capacity ?? undefined,
      visibility,
      coverImageUrl: coverImageUrl || undefined,
      theme: { color: themeColor },
      // Keep the existing status (e.g. 'published') on edit; new drafts default
      // to 'draft'. Never send a hardcoded 'draft' that would unpublish an event.
      status: initialStatus ?? 'draft',
      waitlistEnabled: capacity != null,
      guestListVisible,
      allowPlusOnes,
      allowedResponses: ['going', ...(allowMaybe ? ['maybe'] : []), 'declined'],
      // `hosts` and the form `schema` have no editor in this composer, so we omit
      // them: the create route injects the creator as host and the update route
      // preserves both. (Sending hosts:[]/schema:[] here used to strip the
      // creator's host access and wipe custom RSVP questions on the first save.)
      form: { enabled: true, requireApproval },
      metadata: {
        eventType,
        virtualLink: eventType !== 'in-person' ? virtualLink || undefined : undefined,
      },
      ...overrides,
    }),
    [communityId, title, description, startAt, endAt, timezone, location, capacity, visibility,
     coverImageUrl, themeColor, guestListVisible, allowPlusOnes, allowMaybe, requireApproval, eventType, virtualLink, initialStatus],
  );

  const persist = useCallback(
    async (overrides: Record<string, unknown> = {}): Promise<NBEvent> => {
      const body = buildBody(overrides);
      if (!createdRef.current) {
        createdRef.current = true; // optimistic: prevents a double-create race
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          createdRef.current = false;
          throw new Error((await res.json().catch(() => ({}))).error || 'Could not save event');
        }
        return res.json();
      }
      const res = await fetch(`/api/events/${draftIdRef.current}?communityId=${encodeURIComponent(communityId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save event');
      return res.json();
    },
    [buildBody, communityId],
  );

  // ── autosave (debounced) ─────────────────────────────────────────────────────
  const snapshot = useMemo(() => JSON.stringify(buildBody()), [buildBody]);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!title.trim()) return; // need a title before we can create the draft
    const t = setTimeout(async () => {
      try {
        setSaveState('saving');
        await persist();
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 900);
    return () => clearTimeout(t);
  }, [snapshot, title, persist]);

  const onPickCover = async (file: File | undefined) => {
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { setError(err); return; }
    setError(null);
    setUploading(true);
    try {
      const url = await uploadImage('event', draftIdRef.current, file);
      setCoverImageUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload cover');
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async () => {
    setError(null);
    if (!title.trim()) { setError('Please add a title'); return; }
    if (!startAt) { setError('Please pick a date and time'); return; }
    setPublishing(true);
    try {
      const ev = await persist({ status: 'published' });
      setSaveState('saved');
      setShareEvent(ev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-28">
      {/* top bar */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-grey hover:text-brand-black transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <SaveIndicator state={saveState} />
      </div>

      {error && (
        <div className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm text-red-700 font-medium">{error}</p>
        </div>
      )}

      {/* poster / cover */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPickCover(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="group relative w-full aspect-[16/9] rounded-2xl overflow-hidden border border-gray-200 flex items-center justify-center text-white"
        style={coverImageUrl ? undefined : { background: `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)` }}
      >
        {coverImageUrl ? (
          <img src={coverImageUrl} alt="Event cover" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <ImagePlus className="w-8 h-8 opacity-90" />
            <span className="text-sm font-semibold drop-shadow">{title.trim() || 'Add a cover'}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        {uploading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-white" />
          </div>
        )}
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur text-xs font-semibold">
          <ImagePlus className="w-3.5 h-3.5" />
          {coverImageUrl ? 'Change cover' : 'Upload'}
        </span>
      </button>

      {/* theme swatches when no cover image */}
      {!coverImageUrl && (
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-brand-grey mr-1">Theme</span>
          {THEME_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setThemeColor(c)}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${themeColor === c ? 'border-brand-black scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
              aria-label={`Theme ${c}`}
            />
          ))}
        </div>
      )}

      {/* title */}
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Event name"
        className="w-full mt-6 px-0 py-1 text-3xl font-bold text-brand-black placeholder:text-brand-grey/50 bg-transparent border-0 focus:outline-none focus:ring-0"
      />

      {/* date & time */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CustomDateTimePicker
          label="Starts"
          required
          value={startAt}
          onChange={(v) => {
            setStartAt(v);
            // Keep the end after the start: if the new start is at/after the
            // current end, push the end out by an hour so endAt < startAt is
            // never persisted.
            if (!endAt || new Date(endAt) <= new Date(v)) setEndAt(plusHoursIso(v, 1));
          }}
          placeholder="Start date & time"
        />
        <CustomDateTimePicker label="Ends" value={endAt} onChange={(v) => setEndAt(v)} placeholder="End date & time" />
      </div>
      <p className="mt-1.5 text-xs text-brand-grey">Times shown in {timezone}</p>

      {/* location */}
      <div className="mt-5">
        <label className="block text-sm font-medium text-brand-black mb-2">Location</label>
        <div className="flex gap-2 mb-3 justify-center">
          {([
            { value: 'in-person', label: 'In person', icon: <MapPin className="w-4 h-4" /> },
            { value: 'virtual', label: 'Virtual', icon: <Video className="w-4 h-4" /> },
            { value: 'hybrid', label: 'Hybrid', icon: <Globe className="w-4 h-4" /> },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setEventType(opt.value)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-md border text-sm font-medium transition-colors ${
                eventType === opt.value
                  ? 'bg-brand-green text-white border-brand-green'
                  : 'bg-brand-white text-brand-grey border-gray-200 hover:border-brand-green hover:text-brand-black'
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
        {(eventType === 'in-person' || eventType === 'hybrid') && (
          <LocationAutocomplete
            value={location.label || ''}
            onChange={(place) => setLocation({ label: place.label, address: place.address, lat: place.lat, lon: place.lon })}
            placeholder="Search for a venue or address…"
            className={inputClass()}
          />
        )}
        {(eventType === 'virtual' || eventType === 'hybrid') && (
          <input
            type="url"
            value={virtualLink}
            onChange={(e) => setVirtualLink(e.target.value)}
            placeholder="https://zoom.us/j/…  (meeting link)"
            className={`${inputClass()} ${eventType === 'hybrid' ? 'mt-3' : ''}`}
          />
        )}
      </div>

      {/* description */}
      <div className="mt-5">
        <label className="block text-sm font-medium text-brand-black mb-2">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Add details people should know…"
          className={`${inputClass()} resize-none`}
        />
      </div>

      {/* more options */}
      <div className="mt-5 border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3.5 bg-brand-light-bg/50 hover:bg-brand-light-bg transition-colors"
        >
          <span className="text-sm font-semibold text-brand-black">More options</span>
          {detailsOpen ? <ChevronUp className="w-4 h-4 text-brand-grey" /> : <ChevronDown className="w-4 h-4 text-brand-grey" />}
        </button>
        {detailsOpen && (
          <div className="px-5 py-5 space-y-5">
            {/* visibility */}
            <div>
              <label className="block text-sm font-medium text-brand-black mb-2.5">Who can RSVP?</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {VISIBILITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setVisibility(opt.value)}
                    className={`flex flex-col items-start gap-1 p-3.5 rounded-xl border-2 text-left transition-all ${
                      visibility === opt.value ? 'border-brand-green bg-brand-light-bg' : 'border-gray-200 hover:border-brand-green/40'
                    }`}
                  >
                    <div className={`flex items-center gap-2 font-semibold text-sm ${visibility === opt.value ? 'text-brand-green' : 'text-brand-black'}`}>
                      {opt.icon}
                      {opt.label}
                    </div>
                    <span className="text-xs text-brand-grey">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* capacity */}
            <div>
              <label className="block text-sm font-medium text-brand-black mb-2">Capacity</label>
              <input
                type="number"
                min={1}
                value={capacity ?? ''}
                onChange={(e) => setCapacity(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                placeholder="Unlimited"
                className={inputClass()}
              />
              {capacity != null && (
                <p className="mt-1.5 text-xs text-brand-grey">When full, new RSVPs join a waitlist automatically.</p>
              )}
            </div>

            {/* +guests */}
            <div>
              <label className="block text-sm font-medium text-brand-black mb-2">Allow guests to bring up to</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={allowPlusOnes}
                  onChange={(e) => setAllowPlusOnes(Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)))}
                  className={`${inputClass()} w-24`}
                />
                <span className="text-sm text-brand-grey">extra {allowPlusOnes === 1 ? 'guest' : 'guests'}</span>
              </div>
            </div>

            {/* toggles */}
            <Toggle label="Require approval" hint="Manually approve each RSVP" value={requireApproval} onChange={setRequireApproval} />
            <Toggle label="Show guest list" hint="Guests can see who else is coming" value={guestListVisible} onChange={setGuestListVisible} />
            <Toggle label='Allow "Maybe"' hint="Let guests reply Maybe as well as Going" value={allowMaybe} onChange={setAllowMaybe} />
          </div>
        )}
      </div>

      {/* sticky publish bar */}
      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-gray-200 bg-brand-white/95 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <SaveIndicator state={saveState} />
          <button
            onClick={handlePublish}
            disabled={publishing || uploading}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-brand-green rounded-lg hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
          >
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {mode === 'edit' ? 'Save changes' : 'Publish event'}
          </button>
        </div>
      </div>

      {shareEvent && (
        <ShareSheet
          event={shareEvent}
          communityId={communityId}
          onClose={() => router.push(`/events/${shareEvent.id}`)}
        />
      )}
    </div>
  );
}

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle') return <span className="text-xs text-brand-grey">Draft</span>;
  if (state === 'saving') return <span className="inline-flex items-center gap-1.5 text-xs text-brand-grey"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</span>;
  if (state === 'error') return <span className="text-xs text-red-600">Couldn’t save — keep editing</span>;
  return <span className="inline-flex items-center gap-1.5 text-xs text-brand-green"><Check className="w-3.5 h-3.5" /> Saved</span>;
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <div>
        <span className="text-sm font-medium text-brand-black">{label}</span>
        <p className="text-xs text-brand-grey">{hint}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-brand-green' : 'bg-gray-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

function ShareSheet({ event, communityId, onClose }: { event: NBEvent; communityId: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const slug = event.slug ?? event.id.replace(/^event:/, '');
  // Only `public` events have a working /e/<slug> page; community/unlisted events
  // are shared via their in-app page (members only). Don't hand out a public link
  // that the visibility gate would 404.
  const isPublic = event.visibility === 'public';
  const path = isPublic ? `/e/${slug}` : `/events/${event.id}`;
  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;

  const copy = async () => {
    if (await copyToClipboard(publicUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md bg-brand-white rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-brand-black">You’re live! 🎉</h2>
            <p className="text-sm text-brand-grey mt-1">Share the link and start collecting RSVPs.</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-brand-grey hover:text-brand-black rounded-lg" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 flex items-center gap-2 p-3 rounded-xl border border-gray-200 bg-brand-light-bg/40">
          <span className="flex-1 text-sm text-brand-black truncate">{publicUrl}</span>
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-brand-green rounded-lg hover:opacity-90 transition-all"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <a
            href={`/api/events/${event.id}/ics?communityId=${encodeURIComponent(communityId)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green hover:bg-brand-light-bg transition-all"
          >
            <CalendarPlus className="w-4 h-4" /> Add to calendar
          </a>
          <a
            href={path}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green hover:bg-brand-light-bg transition-all"
          >
            <ExternalLink className="w-4 h-4" /> View page
          </a>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full px-4 py-2.5 text-sm font-semibold text-white bg-brand-green rounded-lg hover:opacity-90 transition-all"
        >
          Manage event &amp; guests
        </button>
      </div>
    </div>
  );
}
