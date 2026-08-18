'use client';

/**
 * The loginless RSVP form on the public /e/<slug> page. Name + optional email,
 * Going / Maybe / Can't go, +guests when the host allows it, and the host's
 * custom registration questions. When the event is full the submit button
 * morphs into "Join waitlist" (or the form is replaced by a sold-out notice if
 * the host disabled the waitlist). Posts to the public RSVP endpoint and shows
 * a confirmation with an "add to calendar" link.
 */

import { useState } from 'react';
import type { RSVPResponse, FormField } from '@/lib/types';
import { CalendarPlusIcon, CheckIcon, LoaderCircleIcon } from '@/features/shared/icons';
import Select from '@/components/ui/Select';
import { fetchJsonBody } from '@/lib/fetchJson';
import { RegistrationField } from '@/features/events/components/RegistrationField';
import { missingRequiredAnswers, RESPONSE_LABELS } from '@/lib/eventUtils';

interface PublicRsvpFormProps {
  slug: string;
  allowPlusOnes: number;
  allowedResponses: RSVPResponse[];
  formSchema: FormField[];
  isFull: boolean;
  waitlistEnabled: boolean;
  requireApproval: boolean;
}

const inputCls =
  'w-full px-4 py-3 border border-gray-200 rounded-xl bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green transition-all';

export function PublicRsvpForm({
  slug, allowPlusOnes, allowedResponses, formSchema, isFull, waitlistEnabled, requireApproval,
}: PublicRsvpFormProps) {
  // Sold out with the waitlist off: "going" is no longer on the table, but the
  // form stays up so existing guests can still change to maybe / can't go
  // (freeing their spot) — otherwise a full event could never un-fill.
  const soldOut = isFull && !waitlistEnabled;
  const responses = (allowedResponses?.length ? allowedResponses : (['going', 'maybe', 'declined'] as RSVPResponse[]))
    .filter((r) => !soldOut || r !== 'going');

  const [response, setResponse] = useState<RSVPResponse>(responses[0] ?? 'going');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plusOnes, setPlusOnes] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string } | null>(null);

  const joinsWaitlist = isFull && waitlistEnabled && response === 'going';

  const setAnswer = (id: string, value: string | boolean) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Please add your name'); return; }
    // Same predicate the RSVP endpoints enforce server-side.
    const missing = missingRequiredAnswers(formSchema, { response, answers });
    if (missing.length > 0) { setError(`Please answer: ${missing.join(', ')}`); return; }
    setSubmitting(true);
    try {
      const data = await fetchJsonBody<{ message?: string }>(`/api/public/events/${encodeURIComponent(slug)}/rsvp`, 'POST', {
        name: name.trim(),
        email: email.trim() || undefined,
        response,
        plusOnes: response === 'going' ? plusOnes : 0,
        answers: response === 'going' && Object.keys(answers).length ? answers : undefined,
      });
      setDone({ message: data?.message || "You're in!" });
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
          <CheckIcon className="w-6 h-6 text-white" />
        </div>
        <p className="text-base font-semibold text-brand-black">{done.message}</p>
        <a
          href={`/api/public/events/${encodeURIComponent(slug)}/ics`}
          className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green transition-all"
        >
          <CalendarPlusIcon className="w-4 h-4" /> Add to calendar
        </a>
      </div>
    );
  }

  // Sold out, waitlist off, and the host only allows "going" — nothing to submit.
  if (soldOut && responses.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-brand-light-bg/40 p-6 text-center">
        <p className="text-base font-semibold text-brand-black">This event is sold out</p>
        <p className="mt-1 text-sm text-brand-grey">All spots have been taken.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-gray-200 p-5 space-y-4">
      {soldOut && (
        <div className="rounded-xl bg-brand-light-bg/40 border border-gray-200 px-4 py-3 text-center">
          <p className="text-sm font-semibold text-brand-black">This event is sold out</p>
          <p className="mt-0.5 text-xs text-brand-grey">Already RSVP&apos;d? You can still update your response below.</p>
        </div>
      )}

      {/* response buttons */}
      <div className={`grid gap-2 ${responses.length === 1 ? 'grid-cols-1' : responses.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
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

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inputCls} />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email (for your confirmation)"
        className={inputCls}
      />

      {allowPlusOnes > 0 && response === 'going' && !isFull && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-brand-black">Bringing guests?</span>
          <Select
            value={plusOnes}
            onChange={(e) => setPlusOnes(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: allowPlusOnes + 1 }, (_, i) => (
              <option key={i} value={i}>{i === 0 ? 'Just me' : `+${i}`}</option>
            ))}
          </Select>
        </label>
      )}

      {/* host's registration questions */}
      {response === 'going' && formSchema.length > 0 && (
        <div className="space-y-3 pt-1">
          {formSchema.map((f) => (
            <RegistrationField
              key={f.id}
              field={f}
              value={answers[f.id]}
              onChange={(v) => setAnswer(f.id, v)}
              classes={{
                field: 'block',
                fieldText: 'block text-sm font-medium text-brand-black mb-1.5',
                input: inputCls,
                checkbox: 'flex items-center gap-2.5 text-sm text-brand-black',
                checkboxInput: 'w-4 h-4 rounded border-gray-300 text-brand-green focus:ring-brand-green',
              }}
            />
          ))}
        </div>
      )}

      {joinsWaitlist && (
        <p className="text-xs text-brand-grey">This event is full — new RSVPs join the waitlist.</p>
      )}
      {requireApproval && response === 'going' && !joinsWaitlist && (
        <p className="text-xs text-brand-grey">RSVPs need host approval before they&apos;re confirmed.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-brand-green rounded-xl hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {submitting && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
        {response === 'declined' ? 'Send response' : joinsWaitlist ? 'Join waitlist' : 'RSVP'}
      </button>
    </form>
  );
}
