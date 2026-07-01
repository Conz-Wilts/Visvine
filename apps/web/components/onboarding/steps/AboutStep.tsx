'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { OnboardingData } from '@/app/onboarding/OnboardingWizard';

interface Props {
  data: OnboardingData;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
  saving: boolean;
}

const MAX_BIO = 500;

export default function AboutStep({ data, onNext, onBack, saving }: Props) {
  const [bio, setBio] = useState(data.bio);

  return (
    <div className="p-8">
      <div className="mb-1">
        <h2 className="text-xl font-bold text-gray-900">About you</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">Tell the community a bit about yourself.</p>

      <div className="mb-4">
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
          placeholder="Your background, what you're working on, or what excites you..."
          rows={5}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green resize-none"
        />
        <p className="text-xs text-gray-400 text-right mt-1">{bio.length}/{MAX_BIO}</p>
      </div>

      <div className="flex justify-between mt-8">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={() => onNext({ bio })}
          disabled={saving}
          className="bg-brand-green text-white rounded-full px-6 py-2.5 text-sm font-semibold hover:opacity-90 active:translate-y-[1px] transition-all duration-200 shadow-soft flex items-center gap-1 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Next'} {!saving && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
