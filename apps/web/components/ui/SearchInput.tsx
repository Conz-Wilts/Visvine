'use client';

import { clsx } from 'clsx';

const SearchIcon = () => (
  <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
  </svg>
);

const ClearIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus = false,
  icon,
  className,
}: SearchInputProps) {
  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5',
        'focus-within:border-brand-green focus-within:bg-white transition-colors',
        className,
      )}
    >
      {icon ?? <SearchIcon />}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Clear search"
        >
          <ClearIcon />
        </button>
      )}
    </div>
  );
}
