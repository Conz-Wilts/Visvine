'use client';

/**
 * Public RSVP form component
 */

import { useState } from 'react';
import type { NBEvent, FormField } from '@/lib/types';
import { CheckCircle, Loader2 } from 'lucide-react';
import Select from '@/components/ui/Select';

interface RSVPFormProps {
  event: NBEvent;
  spaceId: string;
}

interface FormState {
  name: string;
  email: string;
  linkedinUrl: string;
  companyName: string;
  roleTitle: string;
  [key: string]: string | boolean;
}

export function RSVPForm({ event, spaceId }: RSVPFormProps) {
  const [formState, setFormState] = useState<FormState>({
    name: '',
    email: '',
    linkedinUrl: '',
    companyName: '',
    roleTitle: '',
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');

  const handleChange = (field: string, value: string | boolean) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Build answers object from custom fields
      const answers: Record<string, string | boolean> = {};
      for (const field of event.form.schema) {
        if (formState[field.id] !== undefined) {
          answers[field.id] = formState[field.id];
        }
      }

      const response = await fetch(
        `/api/events/${event.id}/attendees?spaceId=${spaceId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formState.name,
            email: formState.email || undefined,
            linkedinUrl: formState.linkedinUrl || undefined,
            companyName: formState.companyName || undefined,
            roleTitle: formState.roleTitle || undefined,
            answers: Object.keys(answers).length > 0 ? answers : undefined,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit RSVP');
      }

      setSubmitted(true);
      setMessage(data.message || 'Successfully registered!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit RSVP');
    } finally {
      setLoading(false);
    }
  };

  const renderField = (field: FormField) => {
    const commonProps = {
      id: field.id,
      required: field.required,
      placeholder: field.placeholder,
      className: 'w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent',
    };

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            {...commonProps}
            value={(formState[field.id] as string) || ''}
            onChange={(e) => handleChange(field.id, e.target.value)}
            rows={4}
          />
        );
      case 'select':
        return (
          <Select
            id={field.id}
            required={field.required}
            value={(formState[field.id] as string) || ''}
            onChange={(e) => handleChange(field.id, e.target.value)}
          >
            <option value="">Select...</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        );
      case 'checkbox':
        return (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              id={field.id}
              checked={(formState[field.id] as boolean) || false}
              onChange={(e) => handleChange(field.id, e.target.checked)}
              className="w-4 h-4 text-brand-green border-gray-300 rounded focus:ring-brand-green"
            />
            <span className="text-sm text-brand-black">{field.label}</span>
          </label>
        );
      default:
        return (
          <input
            {...commonProps}
            type={field.type === 'email' ? 'email' : field.type === 'url' || field.type === 'linkedin' ? 'url' : 'text'}
            value={(formState[field.id] as string) || ''}
            onChange={(e) => handleChange(field.id, e.target.value)}
          />
        );
    }
  };

  if (submitted) {
    return (
      <div className="max-w-md mx-auto text-center space-y-8 py-16">
        <div className="flex justify-center">
          <CheckCircle className="w-20 h-20 text-brand-green" />
        </div>
        <div>
          <h2 className="text-3xl font-bold text-brand-black">
            Thank you!
          </h2>
          <p className="mt-3 text-brand-grey text-lg">
            {message}
          </p>
        </div>
        <a
          href={`/api/events/${event.id}/ics?spaceId=${spaceId}`}
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-brand-white bg-brand-green rounded-lg hover:opacity-90 transition-all shadow-sm"
          download
        >
          Add to Calendar
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">
      {error && (
        <div className="p-4 rounded-lg bg-brand-green/10 border border-brand-green/30">
          <p className="text-sm text-brand-green font-medium">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-brand-black mb-1">
            Full Name <span className="text-brand-green">*</span>
          </label>
          <input
            type="text"
            id="name"
            required
            value={formState.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-brand-black mb-1">
            Email
          </label>
          <input
            type="email"
            id="email"
            value={formState.email}
            onChange={(e) => handleChange('email', e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="companyName" className="block text-sm font-medium text-brand-black mb-1">
            Company
          </label>
          <input
            type="text"
            id="companyName"
            value={formState.companyName}
            onChange={(e) => handleChange('companyName', e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="roleTitle" className="block text-sm font-medium text-brand-black mb-1">
            Role
          </label>
          <input
            type="text"
            id="roleTitle"
            value={formState.roleTitle}
            onChange={(e) => handleChange('roleTitle', e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="linkedinUrl" className="block text-sm font-medium text-brand-black mb-1">
            LinkedIn Profile
          </label>
          <input
            type="url"
            id="linkedinUrl"
            value={formState.linkedinUrl}
            onChange={(e) => handleChange('linkedinUrl', e.target.value)}
            placeholder="https://linkedin.com/in/..."
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-brand-white text-brand-black placeholder:text-brand-grey focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent"
          />
        </div>

        {event.form.schema.map((field) => (
          <div key={field.id}>
            {field.type !== 'checkbox' && (
              <label htmlFor={field.id} className="block text-sm font-medium text-brand-black mb-1">
                {field.label}
                {field.required && <span className="text-brand-green"> *</span>}
              </label>
            )}
            {renderField(field)}
          </div>
        ))}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-6 py-3.5 text-sm font-semibold text-brand-white bg-brand-green rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? 'Submitting...' : 'Submit RSVP'}
      </button>
    </form>
  );
}

