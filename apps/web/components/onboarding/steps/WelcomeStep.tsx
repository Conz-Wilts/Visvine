'use client';

import { Sparkles } from 'lucide-react';

interface Props {
  firstName: string;
  imageUrl: string | null;
  onStart: () => void;
  onSkip: () => void;
}

export default function WelcomeStep({ firstName, imageUrl, onStart, onSkip }: Props) {
  return (
    <div className="p-8 text-center">
      <div className="w-full h-2 bg-gradient-to-r from-brand-green to-brand-dark-green rounded-t-2xl absolute top-0 left-0" />

      <div className="mb-6 mt-4 flex justify-center">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={firstName}
            className="w-24 h-24 rounded-full object-cover ring-4 ring-brand-light-bg"
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-brand-light-bg flex items-center justify-center">
            <span className="text-3xl font-semibold text-brand-dark-green">
              {firstName.charAt(0)}
            </span>
          </div>
        )}
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        Welcome, {firstName}!
      </h1>
      <p className="text-gray-500 mb-8 max-w-sm mx-auto">
        Let&apos;s set up your profile so people in the community can find and connect with you.
      </p>

      <button
        onClick={onStart}
        className="w-full bg-brand-green text-white rounded-full py-3 px-6 font-semibold hover:opacity-90 active:translate-y-[1px] transition-all duration-200 shadow-soft flex items-center justify-center gap-2"
      >
        <Sparkles className="w-5 h-5" />
        Set Up My Profile
      </button>

      <button
        onClick={onSkip}
        className="mt-4 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        I&apos;ll do this later
      </button>
    </div>
  );
}
