'use client';

/**
 * The loginless RSVP form on the public /e/<slug> page. Name + optional email,
 * Going / Maybe / Can't go, and +guests when the host allows it. Posts to the
 * public RSVP endpoint and shows a confirmation with an "add to calendar" link.
 */

import { useState } from 'react';
import type { RSVPResponse } from '@/lib/types';
import { Check, Loader2, CalendarPlus } from 'lucide-react';

interface PublicRsvpFormProps {
  slug: string;
  allowPlusOnes: number;
  allowedResponses: RSVPResponse[];
}

const RESPONSE_LABELS: Record<RSVPResponse, string> = {
  going: "I'm going",
  maybe: 'Maybe',
  declined: "Can't go",
};

export function PublicRsvpForm({ slug, allowPlusOnes, allowedResponses }: PublicRsvpFormProps) {
  const [response, setResponse] = useState<RSVPResponse>('going');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plusOnes, setPlusOnes] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string } | null>(null);

  const responses = allowedResponses?.length ? allowedResponses : (['going', 'maybe', 'declined'] as RSVPResponse[]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Please add your name'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/events/${encodeURIComponent(slug)}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          response,
          plusOnes: response === 'going' ? plusOnes : 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not submit your RSVP');
      setDone({ message: data.message || "You're in!" });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-brand-green/30 bg-brand-light-bg/50 p-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-brand-green flex items-center justify-center mb-3">
          <Check className="w-6 h-6 text-white" />
        </div>
        <p className="text-base font-semibold text-brand-black">{done.message}</p>
        <a
          href={`/api/public/events/${encodeURIComponent(slug)}/ics`}
          className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green transition-all"
        >
          <CalendarPlus className="w-4 h-4" /> Add to calendar
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-gray-200 p-5 space-y-4">
      {/* response buttons */}
      <div className="grid grid-cols-3 gap-2">
        {(['going', 'maybe', 'declined'] as RSVPResponse[]).filter((r) => responses.includes(r)).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setResponse(r)}
            className={`px-3 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
              response === r ? 'border-brand-green bg-brand-green text-white' : 'border-gray-200 text-brand-black hover:border-brand-green/50'
            }`}
          >
            {RESPONSE_LABELS[r]}
          </button>
        ))}
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green transition-all"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email (for your confirmation)"
        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green transition-all"
      />

      {allowPlusOnes > 0 && response === 'going' && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-brand-black">Bringing guests?</span>
          <select
            value={plusOnes}
            onChange={(e) => setPlusOnes(parseInt(e.target.value, 10))}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-brand-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-green/20"
          >
            {Array.from({ length: allowPlusOnes + 1 }, (_, i) => (
              <option key={i} value={i}>{i === 0 ? 'Just me' : `+${i}`}</option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-brand-green rounded-xl hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {response === 'declined' ? 'Send response' : 'RSVP'}
      </button>
    </form>
  );
}
