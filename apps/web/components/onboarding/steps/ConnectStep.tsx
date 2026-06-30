'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Linkedin, Globe, Phone, Link2 } from 'lucide-react';
import type { OnboardingData } from '@/app/onboarding/OnboardingWizard';

interface Props {
  data: OnboardingData;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
  saving: boolean;
}

export default function ConnectStep({ data, onNext, onBack, saving }: Props) {
  const [linkedinUrl, setLinkedinUrl] = useState(data.linkedinUrl);
  const [twitterUrl, setTwitterUrl] = useState(data.twitterUrl);
  const [website, setWebsite] = useState(data.website);
  const [phone, setPhone] = useState(data.phone);

  // People type "visvine.com"; store a valid URL so links work + match the server.
  const normalizeUrl = (v: string) => {
    const t = v.trim();
    if (!t) return t;
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  };

  const handleNext = () =>
    onNext({
      linkedinUrl: normalizeUrl(linkedinUrl),
      twitterUrl: normalizeUrl(twitterUrl),
      website: normalizeUrl(website),
      phone,
    });

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-1">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
          <Link2 className="h-5 w-5" />
        </span>
        <h2 className="text-xl font-bold text-gray-900">Connect</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">Add links so people can reach you outside the platform.</p>

      <div className="space-y-4">
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
            <Linkedin className="w-4 h-4" /> LinkedIn
          </label>
          <input
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/yourname"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            X / Twitter
          </label>
          <input
            type="url"
            value={twitterUrl}
            onChange={(e) => setTwitterUrl(e.target.value)}
            placeholder="https://x.com/yourname"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
            <Globe className="w-4 h-4" /> Website
          </label>
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://yourwebsite.com"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
            <Phone className="w-4 h-4" /> Phone <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 (555) 123-4567"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green"
          />
          <p className="text-xs text-gray-400 mt-1">Only visible to community members.</p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-8">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => onNext({})}
            disabled={saving}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            Skip for now
          </button>
          <button
            onClick={handleNext}
            disabled={saving}
            className="bg-brand-green text-white rounded-full px-6 py-2.5 text-sm font-semibold hover:opacity-90 active:translate-y-[1px] transition-all duration-200 shadow-soft flex items-center gap-1 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Finish'} {!saving && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
