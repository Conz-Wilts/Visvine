'use client';

import React, { useState } from 'react';
import { Globe, X } from 'lucide-react';

interface RequestUpgradePromptProps {
  columnName: string;
  filledCount: number;
  onRequest: () => void;
  onDismiss: () => void;
}

export default function RequestUpgradePrompt({
  columnName,
  filledCount,
  onRequest,
  onDismiss,
}: RequestUpgradePromptProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss();
  };

  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-purple-50 border border-purple-200 rounded-xl text-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Globe className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-purple-800 font-medium">
          &ldquo;{columnName}&rdquo; has data for {filledCount} {filledCount === 1 ? 'person' : 'people'}
        </p>
        <p className="text-purple-600 text-xs mt-0.5">
          Want teammates to see and contribute to this column too?
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onRequest}
          className="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          Request it
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1.5 rounded-lg text-purple-400 hover:text-purple-600 hover:bg-purple-100 transition-colors"
          title="Keep private"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
