'use client';

import React, { useState } from 'react';
import { Check, Circle } from 'lucide-react';
import type { FullProfile } from '@/lib/profileTypes';
import { computeProfileCompletion } from '@/lib/profileTypes';

interface Props {
  profile: FullProfile;
}

export default function ProfileCompletionBanner({ profile }: Props) {
  const [hovered, setHovered] = useState(false);
  const { score, sections } = computeProfileCompletion(profile);

  if (score === 100) return null;

  const incomplete = Object.values(sections).filter((s) => !s.complete);
  const complete = Object.values(sections).filter((s) => s.complete);

  // Circle size and stroke
  const size = 56;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className="fixed bottom-6 right-6 z-50"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Tooltip on hover */}
      {hovered && (
        <div className="absolute bottom-full right-0 mb-3 w-64 bg-surface-1 border border-border-subtle rounded-2xl shadow-lg p-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <p className="text-sm font-semibold text-text-primary mb-3">
            Profile {score}% complete
          </p>
          <div className="space-y-1.5">
            {complete.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs font-medium text-green-600">
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                {s.label}
              </div>
            ))}
            {incomplete.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs font-medium text-text-muted">
                <Circle className="w-3.5 h-3.5 flex-shrink-0 opacity-50" />
                {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Circular progress indicator */}
      <div className="relative cursor-pointer group">
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-border-subtle"
          />
          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="text-amber-500 transition-all duration-500"
          />
        </svg>
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold text-text-primary">{score}%</span>
        </div>
        {/* Subtle background fill */}
        <div className="absolute inset-0 rounded-full bg-surface-1 border border-border-subtle -z-10 shadow-md group-hover:shadow-lg transition-shadow" />
      </div>
    </div>
  );
}
