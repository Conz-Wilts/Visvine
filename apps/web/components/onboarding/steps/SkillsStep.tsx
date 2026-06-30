'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, X, Tags } from 'lucide-react';
import type { OnboardingData } from '@/app/onboarding/OnboardingWizard';

interface Props {
  data: OnboardingData;
  onNext: (data: Partial<OnboardingData>) => void;
  onBack: () => void;
  saving: boolean;
}

const SUGGESTED_TAGS = [
  'Product', 'Engineering', 'Design', 'Marketing', 'Sales',
  'Data Science', 'Operations', 'Finance', 'HR', 'Legal',
  'Consulting', 'Entrepreneurship', 'AI/ML', 'Healthcare',
  'Education', 'Sustainability', 'Media', 'Real Estate',
  'Web3', 'Venture Capital', 'Nonprofit',
];

const MAX_TAGS = 15;

export default function SkillsStep({ data, onNext, onBack, saving }: Props) {
  const [tags, setTags] = useState<string[]>(data.tags);
  const [input, setInput] = useState('');

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.length >= MAX_TAGS || tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
    setTags((prev) => [...prev, trimmed]);
    setInput('');
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    }
  };

  const unselectedSuggestions = SUGGESTED_TAGS.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-1">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
          <Tags className="h-5 w-5" />
        </span>
        <h2 className="text-xl font-bold text-gray-900">Skills & Interests</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">Add tags so others with similar interests can find you.</p>

      {/* Selected tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 bg-brand-green text-white text-xs font-medium px-3 py-1.5 rounded-full">
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:opacity-70">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length >= MAX_TAGS ? 'Maximum tags reached' : 'Type a tag and press Enter'}
        disabled={tags.length >= MAX_TAGS}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green mb-1 disabled:bg-gray-50"
      />
      <p className="text-xs text-gray-400 mb-4">{tags.length}/{MAX_TAGS} tags</p>

      {/* Suggestions */}
      {unselectedSuggestions.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">Suggestions</p>
          <div className="flex flex-wrap gap-1.5">
            {unselectedSuggestions.map((tag) => (
              <button
                key={tag}
                onClick={() => addTag(tag)}
                disabled={tags.length >= MAX_TAGS}
                className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-40"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

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
            onClick={() => onNext({ tags })}
            disabled={saving}
            className="bg-brand-green text-white rounded-full px-6 py-2.5 text-sm font-semibold hover:opacity-90 active:translate-y-[1px] transition-all duration-200 shadow-soft flex items-center gap-1 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Next'} {!saving && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
