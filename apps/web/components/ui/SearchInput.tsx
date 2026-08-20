'use client';

import { clsx } from 'clsx';

const SearchIcon = () => (
  <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        'flex items-center gap-2 rounded-lg bg-surface-2 px-3.5 py-2.5 transition-colors',
        'focus-within:bg-surface-1 focus-within:ring-1 focus-within:ring-border-default',
        className,
      )}
    >
      {icon ?? <SearchIcon />}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-text-muted hover:text-text-primary"
          aria-label="Clear search"
        >
          <ClearIcon />
        </button>
      )}
    </div>
  );
}
