'use client';

import React from 'react';
import { X } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface EditModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export default function EditModal({ title, open, onClose, children, size = 'md' }: EditModalProps) {
  useEscapeKey(onClose, open);

  if (!open) return null;

  // Scale with the viewport: never narrower than the old fixed cap, grow as a
  // share of screen width on large monitors, with a sane upper bound.
  const maxW =
    size === 'sm'
      ? 'max-w-[clamp(24rem,30vw,32rem)]'
      : size === 'lg'
        ? 'max-w-[clamp(42rem,55vw,68rem)]'
        : 'max-w-[clamp(32rem,42vw,52rem)]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`w-full ${maxW} bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-brand-black">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-brand-grey hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
