'use client';

import { useSpaceHref } from '@/features/shared/contexts/SpaceContext';
import { Alert, Button, Modal, Select, Checkbox } from '@visvine/ui';
import { palette } from '@visvine/tokens';

/**
 * EventComposer — the single-screen, poster-first editor for an event that
 * exists. Events are made by `create_event` (an AI over MCP, which asks for the
 * details first) as a draft; this is where a person reads it back, fixes it and
 * publishes it. Four things matter to publish: cover, title, date/time,
 * location. Everything else lives behind one "More options" toggle. Edits
 * autosave; "Publish" opens a share sheet (copy link + add to calendar).
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useCopied } from '@/features/shared/hooks/useCopied';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { uploadImage, validateImageFile } from '@/lib/imageUpload';
import type { NBEvent, EventVisibility, FormField } from '@/lib/types';
import { VenueAutocomplete } from './VenueAutocomplete';
import { CustomDateTimePicker } from './CustomDateTimePicker';
import { DriveCoverPicker } from './DriveCoverPicker';
import { fetchJsonBody } from '@/lib/fetchJson';
import { invalidateEventDetail } from '@/features/events/lib/eventDetail';
import { ArrowLeftIcon, CalendarPlusIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, FolderIcon, GlobeIcon, ImagePlusIcon, Link2Icon, LoaderCircleIcon, LockIcon, MapPinIcon, PlusIcon, SparklesIcon, Trash2Icon, UsersIcon, VideoIcon, XIcon } from '@/features/shared/icons';

type EventType = 'in-person' | 'virtual' | 'hybrid';

// A registration question being edited. Options are kept as the raw
// comma-separated text while typing and only parsed into an array on save.
type DraftQuestion = {
  id: string;
  label: string;
  type: FormField['type'];
  required: boolean;
  optionsText: string;
};

// Must cover every type formFieldSchema allows — events created with the old
// builder can carry email/linkedin/company questions, and a <Select> whose
// value isn't in its option list silently displays (and on change, rewrites
// to) the wrong type.
const QUESTION_TYPES: { value: FormField['type']; label: string }[] = [
  { value: 'text', label: 'Short answer' },
  { value: 'textarea', label: 'Long answer' },
  { value: 'select', label: 'Multiple choice' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'Website' },
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'company', label: 'Company' },
];

interface EventComposerProps {
  spaceId: string;
  initialEvent: NBEvent;
  onDelete?: () => void;
}

const THEME_COLORS = [
  palette.visvine[400], palette.blue[600], palette.purple[600], palette.red[500],
  palette.amber[500], palette.sky[500], palette.pink[500], palette.gray[900],
];

const VISIBILITY_OPTIONS: { value: EventVisibility; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'space', label: 'Space', icon: <UsersIcon className="w-4 h-4" />, description: 'Members of this space' },
  { value: 'public', label: 'Public link', icon: <GlobeIcon className="w-4 h-4" />, description: 'Anyone with the link can RSVP' },
  { value: 'private', label: 'Unlisted', icon: <LockIcon className="w-4 h-4" />, description: 'Only people you invite' },
];

function inputClass() {
  return 'w-full px-4 py-3 rounded-lg bg-surface-subtle text-fg placeholder:text-fg-muted focus:outline-none focus:bg-surface focus:ring-1 focus:ring-line transition-colors';
}

function randomId(len: number): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, len)
    : Math.random().toString(36).slice(2, 2 + len);
}

function makeQuestionId(): string {
  return `q_${randomId(8)}`;
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

export function EventComposer({ spaceId, initialEvent, onDelete }: EventComposerProps) {
  const router = useSpaceRouter();
  const eventId = initialEvent.id;

  const initialType = (initialEvent.metadata?.eventType as EventType) ?? 'in-person';
  // Preserve the loaded status so an autosave can't unpublish the event.
  // "Publish" overrides this explicitly.
  const initialStatus = initialEvent.status;

  // ── form state ──────────────────────────────────────────────────────────────
  const [title, setTitle] = useState(initialEvent.title ?? '');
  const [description, setDescription] = useState(initialEvent.description ?? '');
  const [startAt, setStartAt] = useState(initialEvent.startAt || nextTopOfHourIso());
  const [endAt, setEndAt] = useState(initialEvent.endAt || plusHoursIso(initialEvent.startAt || nextTopOfHourIso(), 1));
  const [timezone] = useState(initialEvent.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [eventType, setEventType] = useState<EventType>(initialType);
  const [virtualLink, setVirtualLink] = useState((initialEvent.metadata?.virtualLink as string) ?? '');
  const [location, setLocation] = useState(initialEvent.location ?? { label: '' });
  const [coverImageUrl, setCoverImageUrl] = useState(initialEvent.coverImageUrl ?? '');
  const [themeColor, setThemeColor] = useState(initialEvent.theme?.color ?? THEME_COLORS[0]);
  const [visibility, setVisibility] = useState<EventVisibility>(initialEvent.visibility ?? 'space');
  const [capacity, setCapacity] = useState<number | undefined>(initialEvent.capacity);
  const [requireApproval, setRequireApproval] = useState(initialEvent.form?.requireApproval ?? false);
  const [guestListVisible, setGuestListVisible] = useState(initialEvent.guestListVisible ?? true);
  const [allowPlusOnes, setAllowPlusOnes] = useState(initialEvent.allowPlusOnes ?? 0);
  const [allowMaybe, setAllowMaybe] = useState(initialEvent.allowedResponses ? initialEvent.allowedResponses.includes('maybe') : true);
  const [waitlistEnabled, setWaitlistEnabled] = useState(initialEvent.waitlistEnabled !== false);
  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    (initialEvent.form?.schema ?? []).map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required ?? false,
      optionsText: (f.options ?? []).join(', '),
    })),
  );

  // ── ui state ────────────────────────────────────────────────────────────────
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareEvent, setShareEvent] = useState<NBEvent | null>(null);
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildBody = useCallback(
    (overrides: Record<string, unknown> = {}) => ({
      id: eventId,
      spaceId,
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
      // Keep the existing status: never send a hardcoded 'draft' that would
      // unpublish an event.
      status: initialStatus ?? 'draft',
      waitlistEnabled: capacity != null ? waitlistEnabled : undefined,
      guestListVisible,
      allowPlusOnes,
      allowedResponses: ['going', ...(allowMaybe ? ['maybe'] : []), 'declined'],
      // `hosts` has no editor in this composer, so we omit it: the create route
      // injects the creator as host and the update route preserves it. Sending
      // hosts:[] would strip the creator's host access on the first save.
      // The question schema IS owned by this composer — state is seeded from the
      // loaded event on edit, so sending it can't wipe anything.
      form: {
        enabled: true,
        requireApproval,
        schema: questions
          .filter((q) => q.label.trim())
          .map((q) => ({
            id: q.id,
            label: q.label.trim(),
            type: q.type,
            required: q.required || undefined,
            options:
              q.type === 'select'
                ? q.optionsText.split(',').map((s) => s.trim()).filter(Boolean)
                : undefined,
          })),
      },
      metadata: {
        eventType,
        virtualLink: eventType !== 'in-person' ? virtualLink || undefined : undefined,
      },
      ...overrides,
    }),
    [eventId, spaceId, title, description, startAt, endAt, timezone, location, capacity, visibility,
     coverImageUrl, themeColor, guestListVisible, allowPlusOnes, allowMaybe, requireApproval, eventType, virtualLink, initialStatus,
     waitlistEnabled, questions],
  );

  const updateQuestion = (id: string, patch: Partial<DraftQuestion>) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const removeQuestion = (id: string) => setQuestions((prev) => prev.filter((q) => q.id !== id));
  const addQuestion = () =>
    setQuestions((prev) => [...prev, { id: makeQuestionId(), label: '', type: 'text', required: false, optionsText: '' }]);

  const persist = useCallback(
    async (overrides: Record<string, unknown> = {}): Promise<NBEvent> => {
      const body = buildBody(overrides);
      const saved = await fetchJsonBody<NBEvent>(
        `/api/events/${eventId}?spaceId=${encodeURIComponent(spaceId)}`,
        'PATCH',
        body,
      );
      invalidateEventDetail(saved.id);
      return saved;
    },
    [buildBody, eventId, spaceId],
  );

  // ── autosave (debounced) ─────────────────────────────────────────────────────
  const snapshot = useMemo(() => JSON.stringify(buildBody()), [buildBody]);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!title.trim()) return; // an event is never saved without a title
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
      const url = await uploadImage('event', eventId, file);
      setCoverImageUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload cover');
    } finally {
      setUploading(false);
    }
  };

  /**
   * The Drive picker posts to the event's cover route, which reads the saved
   * event — so pending edits are saved first rather than overwritten by it.
   */
  const openDrivePicker = async () => {
    setError(null);
    if (!title.trim()) { setError('Add a title first, then pick a cover'); return; }
    setUploading(true);
    try {
      await persist();
      setSaveState('saved');
      setDrivePickerOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the draft');
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async () => {
    setError(null);
    if (!title.trim()) { setError('Please add a title'); return; }
    if (!startAt) { setError('Please pick a date and time'); return; }
    // A multiple-choice question with no options renders an unanswerable form
    // (a required one would block every registration).
    const optionless = questions.find(
      (q) => q.label.trim() && q.type === 'select' && !q.optionsText.split(',').some((s) => s.trim()),
    );
    if (optionless) {
      setError(`Add options (comma separated) to your multiple choice question “${optionless.label.trim()}”`);
      return;
    }
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
          className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" /> Back
        </button>
        <SaveIndicator state={saveState} />
      </div>

      {error && (
        <Alert className="mb-4">{error}</Alert>
      )}

      {/* poster / cover */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPickCover(e.target.files?.[0])}
      />
      <div className="group relative w-full aspect-[16/9] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="absolute inset-0 w-full h-full flex items-center justify-center text-white"
          style={coverImageUrl ? undefined : { background: themeColor }}
        >
          {coverImageUrl ? (
            <img src={coverImageUrl} alt="Event cover" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 text-center">
              <ImagePlusIcon className="w-8 h-8 opacity-90" />
              <span className="text-sm font-semibold drop-shadow">{title.trim() || 'Add a cover'}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        </button>
        {uploading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
            <LoaderCircleIcon className="w-6 h-6 animate-spin text-white" />
          </div>
        )}
        {/* Two ways to a poster: bytes from this machine, or a picture the
            space already holds in its Drive. */}
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <button
            type="button"
            onClick={openDrivePicker}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur text-xs font-semibold text-white"
          >
            <FolderIcon className="w-3.5 h-3.5" />
            From Drive
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur text-xs font-semibold text-white"
          >
            <ImagePlusIcon className="w-3.5 h-3.5" />
            {coverImageUrl ? 'Change cover' : 'Upload'}
          </button>
        </div>
      </div>

      {/* theme swatches when no cover image */}
      {!coverImageUrl && (
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-fg-muted mr-1">Theme</span>
          {THEME_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setThemeColor(c)}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${themeColor === c ? 'border-fg scale-110' : 'border-transparent'}`}
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
        className="w-full mt-6 px-0 py-1 text-3xl font-bold text-fg placeholder:text-fg-muted/50 bg-transparent border-0 focus:outline-none focus:ring-0"
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
      <p className="mt-1.5 text-xs text-fg-muted">Times shown in {timezone}</p>

      {/* location */}
      <div className="mt-5">
        <label className="block text-sm font-medium text-fg mb-2">Location</label>
        <div className="flex gap-2 mb-3 justify-center">
          {([
            { value: 'in-person', label: 'In person', icon: <MapPinIcon className="w-4 h-4" /> },
            { value: 'virtual', label: 'Virtual', icon: <VideoIcon className="w-4 h-4" /> },
            { value: 'hybrid', label: 'Hybrid', icon: <GlobeIcon className="w-4 h-4" /> },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setEventType(opt.value)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-md border text-sm font-medium transition-colors ${
                eventType === opt.value
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-subtle text-fg-muted border-line-subtle hover:border-accent hover:text-fg'
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
        {(eventType === 'in-person' || eventType === 'hybrid') && (
          <VenueAutocomplete value={location} onChange={setLocation} className={inputClass()} />
        )}
        {(eventType === 'virtual' || eventType === 'hybrid') && (
          <input
            type="url"
            value={virtualLink}
            onChange={(e) => setVirtualLink(e.target.value)}
            placeholder="Virtual meeting link"
            className={`${inputClass()} ${eventType === 'hybrid' ? 'mt-3' : ''}`}
          />
        )}
      </div>

      {/* description */}
      <div className="mt-5">
        <label className="block text-sm font-medium text-fg mb-2">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Add details people should know…"
          className={`${inputClass()} resize-none`}
        />
      </div>

      {/* more options */}
      <div className="mt-6 border-t border-line-subtle">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="w-full flex items-center justify-between py-3.5 transition-colors hover:text-fg"
        >
          <span className="text-sm font-semibold text-fg">More options</span>
          {detailsOpen ? <ChevronUpIcon className="w-4 h-4 text-fg-muted" /> : <ChevronDownIcon className="w-4 h-4 text-fg-muted" />}
        </button>
        {detailsOpen && (
          <div className="pb-5 space-y-5">
            {/* visibility */}
            <div>
              <label className="block text-sm font-medium text-fg mb-2.5">Who can RSVP?</label>
              <div className="-mx-3">
                {VISIBILITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setVisibility(opt.value)}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      visibility === opt.value ? 'bg-surface-muted' : 'hover:bg-surface-subtle'
                    }`}
                  >
                    <div className={`flex items-center gap-2 text-sm ${visibility === opt.value ? 'font-semibold text-fg' : 'font-medium text-fg-secondary'}`}>
                      {opt.icon}
                      {opt.label}
                    </div>
                    <span className="text-xs text-fg-muted">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* capacity */}
            <div>
              <label className="block text-sm font-medium text-fg mb-2">Capacity</label>
              <input
                type="number"
                min={1}
                value={capacity ?? ''}
                onChange={(e) => setCapacity(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                placeholder="Unlimited"
                className={inputClass()}
              />
              {capacity != null && (
                <div className="mt-3">
                  <Toggle
                    label="Waitlist when full"
                    hint={waitlistEnabled ? 'New RSVPs join the waitlist once every spot is taken' : 'Once full, the event shows as sold out'}
                    value={waitlistEnabled}
                    onChange={setWaitlistEnabled}
                  />
                </div>
              )}
            </div>

            {/* +guests */}
            <div>
              <label className="block text-sm font-medium text-fg mb-2">Allow guests to bring up to</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={allowPlusOnes}
                  onChange={(e) => setAllowPlusOnes(Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)))}
                  className={`${inputClass()} w-24`}
                />
                <span className="text-sm text-fg-muted">extra {allowPlusOnes === 1 ? 'guest' : 'guests'}</span>
              </div>
            </div>

            {/* toggles */}
            <Toggle label="Require approval" hint="Manually approve each RSVP" value={requireApproval} onChange={setRequireApproval} />
            <Toggle label="Show guest list" hint="Guests can see who else is coming" value={guestListVisible} onChange={setGuestListVisible} />
            <Toggle label='Allow "Maybe"' hint="Let guests reply Maybe as well as Going" value={allowMaybe} onChange={setAllowMaybe} />

            {/* registration questions */}
            <div className="pt-4 border-t border-line-subtle">
              <label className="block text-sm font-medium text-fg">Registration questions</label>
              <p className="mt-0.5 text-xs text-fg-muted">Guests answer these when they RSVP. Name and email are always collected.</p>
              {questions.length > 0 && (
                <div className="mt-3 divide-y divide-line-subtle">
                  {questions.map((q) => (
                    <div key={q.id} className="py-3 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          value={q.label}
                          onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                          placeholder="Your question…"
                          className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg bg-surface-subtle text-fg placeholder:text-fg-muted focus:outline-none focus:bg-surface focus:ring-1 focus:ring-line transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => removeQuestion(q.id)}
                          className="p-2 text-fg-muted hover:text-danger transition-colors flex-shrink-0"
                          aria-label="Remove question"
                        >
                          <XIcon className="w-4 h-4" />
                        </button>
                      </div>
                      {q.type === 'select' && (
                        <input
                          value={q.optionsText}
                          onChange={(e) => updateQuestion(q.id, { optionsText: e.target.value })}
                          placeholder="Options, separated by commas"
                          className="w-full px-3 py-2 text-sm rounded-lg bg-surface-subtle text-fg placeholder:text-fg-muted focus:outline-none focus:bg-surface focus:ring-1 focus:ring-line transition-colors"
                        />
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <Select
                          value={q.type}
                          onChange={(e) => updateQuestion(q.id, { type: e.target.value as FormField['type'] })}
                          className="w-44"
                        >
                          {QUESTION_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </Select>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-fg-muted cursor-pointer flex-shrink-0">
                          <Checkbox
                            size="sm"
                            checked={q.required}
                            onChange={(required) => updateQuestion(q.id, { required })}
                          />
                          Required
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={addQuestion}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:opacity-80 transition-opacity"
              >
                <PlusIcon className="w-4 h-4" /> Add question
              </button>
            </div>
          </div>
        )}
      </div>

      {/* sticky publish bar */}
      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-line-subtle bg-surface/95 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger hover:text-danger-strong transition-colors"
              >
                <Trash2Icon className="w-4 h-4" />
                Delete event
              </button>
            )}
            <SaveIndicator state={saveState} />
          </div>
          <button
            onClick={handlePublish}
            disabled={publishing || uploading}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-accent rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {publishing ? <LoaderCircleIcon className="w-4 h-4 animate-spin" /> : <SparklesIcon className="w-4 h-4" />}
            {initialStatus === 'published' ? 'Save changes' : 'Publish event'}
          </button>
        </div>
      </div>

      {drivePickerOpen && (
        <DriveCoverPicker
          spaceId={spaceId}
          eventId={eventId}
          onClose={() => setDrivePickerOpen(false)}
          onPicked={(ev) => {
            // The route has already stored the cover on the record; mirroring it
            // into state keeps the next autosave from posting the old value back.
            setCoverImageUrl(ev.coverImageUrl ?? '');
            setSaveState('saved');
          }}
        />
      )}

      {shareEvent && (
        <ShareSheet
          event={shareEvent}
          spaceId={spaceId}
          onClose={() => router.push(`/events/${shareEvent.id}`)}
        />
      )}
    </div>
  );
}

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle') return <span className="text-xs text-fg-muted">Draft</span>;
  if (state === 'saving') return <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted"><LoaderCircleIcon className="w-3.5 h-3.5 animate-spin" /> Saving…</span>;
  if (state === 'error') return <span className="text-xs text-danger">Couldn’t save — keep editing</span>;
  return <span className="inline-flex items-center gap-1.5 text-xs text-accent"><CheckIcon className="w-3.5 h-3.5" /> Saved</span>;
}

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <div>
        <span className="text-sm font-medium text-fg">{label}</span>
        <p className="text-xs text-fg-muted">{hint}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-accent' : 'bg-line-subtle'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface rounded-full shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

function ShareSheet({ event, spaceId, onClose }: { event: NBEvent; spaceId: string; onClose: () => void }) {
  const [copied, copy] = useCopied(2000);
  const spaceHref = useSpaceHref();
  const slug = event.slug ?? event.id.replace(/^event:/, '');
  // Only `public` events have a working /e/<slug> page; space/unlisted events
  // are shared via their in-app page (members only). Don't hand out a public link
  // that the visibility gate would 404.
  const isPublic = event.visibility === 'public';
  const path = isPublic ? `/e/${slug}` : spaceHref(`/events/${event.id}`);
  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;

  const copyLink = () => { void copy(publicUrl); };

  return (
    <Modal onClose={onClose} title="You’re live" maxWidth="max-w-sm">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2 rounded-lg bg-surface-subtle py-1.5 pl-3 pr-1.5">
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{publicUrl}</span>
          <Button variant="brand" onClick={copyLink} className="inline-flex items-center gap-1.5 !px-3 !py-1.5">
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <Link2Icon className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <a
            href={`/api/events/${event.id}/ics?spaceId=${encodeURIComponent(spaceId)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface-subtle px-4 py-2.5 text-sm font-semibold text-fg-secondary transition-colors hover:bg-surface-muted"
          >
            <CalendarPlusIcon className="h-4 w-4" /> Calendar
          </a>
          <a
            href={path}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface-subtle px-4 py-2.5 text-sm font-semibold text-fg-secondary transition-colors hover:bg-surface-muted"
          >
            <ExternalLinkIcon className="h-4 w-4" /> View page
          </a>
        </div>
      </div>
    </Modal>
  );
}
