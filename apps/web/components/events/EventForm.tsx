'use client';

/**
 * Event creation/editing form — Luma-inspired
 * Supports: cover image, event type, virtual links, co-hosts, tags,
 * ticket tiers, approval settings, guest list controls, custom RSVP fields
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EventInput, FormFieldInput } from '@/lib/schemas/eventSchemas';
import type { EventVisibility, FormFieldType } from '@/lib/types';
import {
  Loader2, Plus, Trash2, ChevronDown, ChevronUp,
  Globe, Lock, Users, MapPin, Video, Link as LinkIcon,
  Image as ImageIcon, Tag, Calendar, Clock, UserPlus,
  HelpCircle,
} from 'lucide-react';
import { CustomDateTimePicker } from './CustomDateTimePicker';
import { LocationAutocomplete } from './LocationAutocomplete';

interface EventFormProps {
  communityId: string;
  initialData?: Partial<EventInput>;
  mode?: 'create' | 'edit';
}

type EventType = 'in-person' | 'virtual' | 'hybrid';

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: 'text', label: 'Short Text' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'company', label: 'Company' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
];

const VIRTUAL_PLATFORMS = [
  { value: 'zoom', label: 'Zoom' },
  { value: 'google-meet', label: 'Google Meet' },
  { value: 'teams', label: 'Microsoft Teams' },
  { value: 'youtube', label: 'YouTube Live' },
  { value: 'other', label: 'Other link' },
];

const EVENT_CATEGORIES = [
  'Networking', 'Workshop', 'Conference', 'Meetup', 'Demo Day',
  'Social', 'Hackathon', 'Panel', 'Keynote', 'Other',
];

const VISIBILITY_OPTIONS: { value: EventVisibility; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'public', label: 'Public', icon: <Globe className="w-4 h-4" />, description: 'Anyone can find and attend' },
  { value: 'community', label: 'Community', icon: <Users className="w-4 h-4" />, description: 'Only community members' },
  { value: 'private', label: 'Private', icon: <Lock className="w-4 h-4" />, description: 'Invite only' },
];

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, icon, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border-subtle rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 bg-surface-2 hover:bg-surface-3 transition-colors"
      >
        <div className="flex items-center gap-2 text-brand-black font-semibold">
          {icon}
          {title}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-brand-grey" /> : <ChevronDown className="w-4 h-4 text-brand-grey" />}
      </button>
      {open && <div className="px-6 py-5 space-y-5 bg-surface-1">{children}</div>}
    </div>
  );
}

function inputClass() {
  return 'w-full px-4 py-3 border border-border-subtle rounded-lg bg-surface-1 text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green transition-all';
}

export function EventForm({ communityId, initialData, mode = 'create' }: EventFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extended state beyond the base EventInput
  const [eventType, setEventType] = useState<EventType>('in-person');
  const [virtualPlatform, setVirtualPlatform] = useState('zoom');
  const [virtualLink, setVirtualLink] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [category, setCategory] = useState('');
  const [coHosts, setCoHosts] = useState<string[]>([]);
  const [coHostInput, setCoHostInput] = useState('');
  const [requireApproval, setRequireApproval] = useState(false);
  const [domainAllowlist, setDomainAllowlist] = useState('');
  const [showGuestList, setShowGuestList] = useState(true);
  const [waitlistEnabled, setWaitlistEnabled] = useState(true);
  const [coverImageUrl, setCoverImageUrl] = useState('');

  const [formData, setFormData] = useState<Partial<EventInput>>({
    title: initialData?.title || '',
    description: initialData?.description || '',
    startAt: initialData?.startAt || '',
    endAt: initialData?.endAt || '',
    timezone: initialData?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    location: initialData?.location || { label: '' },
    hosts: initialData?.hosts || [],
    organizerEmail: initialData?.organizerEmail || '',
    capacity: initialData?.capacity || undefined,
    visibility: initialData?.visibility || 'public',
    form: initialData?.form || { enabled: true, schema: [] },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!formData.startAt) throw new Error('Please select a start date and time');

      const cleanedData = {
        communityId,
        title: formData.title,
        description: formData.description || undefined,
        startAt: formData.startAt,
        endAt: formData.endAt || undefined,
        timezone: formData.timezone || undefined,
        location: formData.location?.label ? {
          ...formData.location,
          ...(eventType === 'virtual' || eventType === 'hybrid' ? { virtualLink } : {}),
        } : undefined,
        hosts: formData.hosts || [],
        organizerEmail: formData.organizerEmail || undefined,
        capacity: formData.capacity || undefined,
        visibility: formData.visibility || 'public',
        form: {
          enabled: true,
          schema: formData.form?.schema || [],
          requireApproval,
          domainAllowlist: domainAllowlist ? domainAllowlist.split(',').map(d => d.trim()).filter(Boolean) : undefined,
        },
        metadata: {
          eventType,
          virtualPlatform: eventType !== 'in-person' ? virtualPlatform : undefined,
          virtualLink: eventType !== 'in-person' ? virtualLink : undefined,
          tags,
          category: category || undefined,
          coHosts,
          showGuestList,
          waitlistEnabled,
          coverImageUrl: coverImageUrl || undefined,
        },
      };

      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanedData),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.details && Array.isArray(data.details)) {
          const msgs = data.details.map((d: { path: string[]; message: string }) => `${d.path.join('.')}: ${d.message}`).join(', ');
          throw new Error(`Validation error: ${msgs}`);
        }
        throw new Error(data.error || 'Failed to create event');
      }

      router.push(`/events/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
      setLoading(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  const addCoHost = () => {
    const h = coHostInput.trim();
    if (h && !coHosts.includes(h)) setCoHosts([...coHosts, h]);
    setCoHostInput('');
  };

  const addFormField = () => {
    const newField: FormFieldInput = { id: `field-${Date.now()}`, label: '', type: 'text', required: false };
    setFormData(prev => ({ ...prev, form: { ...prev.form!, schema: [...(prev.form?.schema || []), newField] } }));
  };

  const removeFormField = (index: number) => {
    setFormData(prev => ({ ...prev, form: { ...prev.form!, schema: prev.form!.schema.filter((_, i) => i !== index) } }));
  };

  const updateFormField = (index: number, updates: Partial<FormFieldInput>) => {
    setFormData(prev => ({
      ...prev,
      form: { ...prev.form!, schema: prev.form!.schema.map((f, i) => i === index ? { ...f, ...updates } : f) },
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-4">
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm text-red-700 font-medium">{error}</p>
        </div>
      )}

      {/* Cover Image */}
      <Section title="Cover Image" icon={<ImageIcon className="w-4 h-4" />} defaultOpen={false}>
        <div>
          <input
            type="url"
            value={coverImageUrl}
            onChange={e => setCoverImageUrl(e.target.value)}
            placeholder="https://example.com/cover.jpg"
            className={inputClass()}
          />
          <p className="text-xs text-brand-grey mt-1">Paste an image URL or leave blank for no cover</p>
          {coverImageUrl && (
            <img src={coverImageUrl} alt="Cover preview" className="mt-3 w-full h-48 object-cover rounded-lg" />
          )}
        </div>
      </Section>

      {/* Basic Info */}
      <Section title="Event Details" icon={<Calendar className="w-4 h-4" />}>
        <div>
          <label className="block text-sm font-medium text-brand-black mb-2">
            Event Title <span className="text-brand-green">*</span>
          </label>
          <input
            type="text"
            required
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
            placeholder="Give your event a name"
            className={inputClass()}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-black mb-2">Description</label>
          <textarea
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            rows={5}
            placeholder="Describe what attendees can expect..."
            className={`${inputClass()} resize-none`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-black mb-2">Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className={inputClass()}
          >
            <option value="">Select a category</option>
            {EVENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-brand-black mb-2">Tags</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder="Add tag and press Enter"
              className={`${inputClass()} flex-1`}
            />
            <button type="button" onClick={addTag} className="px-4 py-2 bg-surface-2 border border-border-subtle rounded-lg text-sm font-medium hover:bg-surface-3 transition-colors text-brand-black">
              Add
            </button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 px-3 py-1 bg-brand-light-bg text-brand-black rounded-full text-sm">
                  <Tag className="w-3 h-3" />
                  {tag}
                  <button type="button" onClick={() => setTags(tags.filter(t => t !== tag))} className="ml-1 text-brand-grey hover:text-brand-black">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* Date & Time */}
      <Section title="Date & Time" icon={<Clock className="w-4 h-4" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <CustomDateTimePicker
              label="Start"
              required={true}
              value={formData.startAt || ''}
              onChange={iso => setFormData({ ...formData, startAt: iso })}
              placeholder="Select start date and time"
            />
          </div>
          <CustomDateTimePicker
            label="End"
            required={false}
            value={formData.endAt || ''}
            onChange={iso => setFormData({ ...formData, endAt: iso || undefined })}
            placeholder="Select end date and time (optional)"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-black mb-2">Timezone</label>
          <input
            type="text"
            value={formData.timezone || ''}
            onChange={e => setFormData({ ...formData, timezone: e.target.value })}
            placeholder="e.g. America/New_York"
            className={inputClass()}
          />
        </div>
      </Section>

      {/* Location */}
      <Section title="Location" icon={<MapPin className="w-4 h-4" />}>
        {/* Event Type */}
        <div>
          <label className="block text-sm font-medium text-brand-black mb-2">Event Type</label>
          <div className="flex gap-2">
            {([
              { value: 'in-person', label: 'In-Person', icon: <MapPin className="w-4 h-4" /> },
              { value: 'virtual', label: 'Virtual', icon: <Video className="w-4 h-4" /> },
              { value: 'hybrid', label: 'Hybrid', icon: <Globe className="w-4 h-4" /> },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEventType(opt.value)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  eventType === opt.value
                    ? 'bg-brand-green text-white border-brand-green'
                    : 'bg-surface-1 text-brand-grey border-border-subtle hover:border-brand-green hover:text-brand-black'
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {(eventType === 'in-person' || eventType === 'hybrid') && (
          <div>
            <label className="block text-sm font-medium text-brand-black mb-2">Venue / Address</label>
            <LocationAutocomplete
              value={formData.location?.label || ''}
              onChange={place => setFormData({
                ...formData,
                location: {
                  label: place.label,
                  address: place.address,
                  lat: place.lat,
                  lon: place.lon,
                },
              })}
              placeholder="Search for a bar, venue, or address..."
              className={inputClass()}
            />
            {formData.location?.address && formData.location.address !== formData.location.label && (
              <p className="text-xs text-brand-grey mt-1.5 flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {formData.location.address}
              </p>
            )}
          </div>
        )}

        {(eventType === 'virtual' || eventType === 'hybrid') && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-brand-black mb-2">Platform</label>
              <select
                value={virtualPlatform}
                onChange={e => setVirtualPlatform(e.target.value)}
                className={inputClass()}
              >
                {VIRTUAL_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-black mb-2">Meeting Link</label>
              <div className="flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-brand-grey flex-shrink-0" />
                <input
                  type="url"
                  value={virtualLink}
                  onChange={e => setVirtualLink(e.target.value)}
                  placeholder="https://zoom.us/j/..."
                  className={inputClass()}
                />
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Visibility & Access */}
      <Section title="Visibility & Access" icon={<Lock className="w-4 h-4" />}>
        <div>
          <label className="block text-sm font-medium text-brand-black mb-3">Who can see this event?</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {VISIBILITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFormData({ ...formData, visibility: opt.value })}
                className={`flex flex-col items-start gap-1 p-4 rounded-xl border-2 text-left transition-all ${
                  formData.visibility === opt.value
                    ? 'border-brand-green bg-brand-light-bg'
                    : 'border-border-subtle hover:border-brand-green/40'
                }`}
              >
                <div className={`flex items-center gap-2 font-semibold text-sm ${formData.visibility === opt.value ? 'text-brand-green' : 'text-brand-black'}`}>
                  {opt.icon}
                  {opt.label}
                </div>
                <span className="text-xs text-brand-grey">{opt.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-black mb-2">Capacity (optional)</label>
          <input
            type="number"
            min="1"
            value={formData.capacity || ''}
            onChange={e => setFormData({ ...formData, capacity: e.target.value ? parseInt(e.target.value) : undefined })}
            placeholder="Leave blank for unlimited"
            className={inputClass()}
          />
        </div>

        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <span className="text-sm font-medium text-brand-black">Require Approval</span>
              <p className="text-xs text-brand-grey">Manually approve each RSVP before they are confirmed</p>
            </div>
            <button
              type="button"
              onClick={() => setRequireApproval(v => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors ${requireApproval ? 'bg-brand-green' : 'bg-surface-3'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${requireApproval ? 'translate-x-5' : ''}`} />
            </button>
          </label>

          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <span className="text-sm font-medium text-brand-black">Enable Waitlist</span>
              <p className="text-xs text-brand-grey">Add registrations to a waitlist when capacity is reached</p>
            </div>
            <button
              type="button"
              onClick={() => setWaitlistEnabled(v => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors ${waitlistEnabled ? 'bg-brand-green' : 'bg-surface-3'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${waitlistEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </label>

          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div>
              <span className="text-sm font-medium text-brand-black">Show Guest List</span>
              <p className="text-xs text-brand-grey">Attendees can see who else is coming</p>
            </div>
            <button
              type="button"
              onClick={() => setShowGuestList(v => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors ${showGuestList ? 'bg-brand-green' : 'bg-surface-3'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${showGuestList ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-black mb-1">Restrict by Email Domain (optional)</label>
          <p className="text-xs text-brand-grey mb-2">Only allow RSVPs from specific email domains</p>
          <input
            type="text"
            value={domainAllowlist}
            onChange={e => setDomainAllowlist(e.target.value)}
            placeholder="company.com, university.edu"
            className={inputClass()}
          />
        </div>
      </Section>

      {/* Hosts */}
      <Section title="Hosts & Organizers" icon={<UserPlus className="w-4 h-4" />} defaultOpen={false}>
        <div>
          <label className="block text-sm font-medium text-brand-black mb-2">Organizer Email</label>
          <input
            type="email"
            value={formData.organizerEmail || ''}
            onChange={e => setFormData({ ...formData, organizerEmail: e.target.value })}
            placeholder="organizer@example.com"
            className={inputClass()}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-black mb-2">Co-Hosts</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={coHostInput}
              onChange={e => setCoHostInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCoHost(); } }}
              placeholder="Co-host email or name"
              className={`${inputClass()} flex-1`}
            />
            <button type="button" onClick={addCoHost} className="px-4 py-2 bg-surface-2 border border-border-subtle rounded-lg text-sm font-medium hover:bg-surface-3 transition-colors text-brand-black">
              Add
            </button>
          </div>
          {coHosts.length > 0 && (
            <div className="mt-2 space-y-1">
              {coHosts.map(h => (
                <div key={h} className="flex items-center justify-between px-3 py-2 bg-surface-2 rounded-lg">
                  <span className="text-sm text-brand-black">{h}</span>
                  <button type="button" onClick={() => setCoHosts(coHosts.filter(c => c !== h))} className="text-brand-grey hover:text-brand-black text-lg leading-none">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* RSVP Form */}
      <Section title="RSVP Form" icon={<HelpCircle className="w-4 h-4" />} defaultOpen={false}>
        <p className="text-sm text-brand-grey">Standard fields (name, email) are always collected. Add custom questions below.</p>

        {formData.form?.schema.map((field, index) => (
          <div key={field.id} className="p-4 border border-border-subtle rounded-xl space-y-3 bg-surface-2">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Field label"
                  value={field.label}
                  onChange={e => updateFormField(index, { label: e.target.value })}
                  className={inputClass()}
                />
                <select
                  value={field.type}
                  onChange={e => updateFormField(index, { type: e.target.value as FormFieldType })}
                  className={inputClass()}
                >
                  {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <button
                type="button"
                onClick={() => removeFormField(index)}
                className="p-2 text-brand-grey hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={field.required || false}
                onChange={e => updateFormField(index, { required: e.target.checked })}
                className="w-4 h-4 text-brand-green border-border-subtle rounded focus:ring-brand-green"
              />
              <span className="text-sm text-brand-black">Required</span>
            </label>
          </div>
        ))}

        <button
          type="button"
          onClick={addFormField}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-border-subtle rounded-xl text-sm font-medium text-brand-grey hover:border-brand-green hover:text-brand-green transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Question
        </button>
      </Section>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-2.5 text-sm font-semibold text-brand-black bg-surface-1 border border-border-subtle rounded-lg hover:border-brand-green hover:bg-brand-light-bg transition-all"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-brand-green rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {mode === 'create' ? 'Create Event' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
