'use client';

import { clsx } from 'clsx';

// Three sizes. `sm` is the box that rides a control bar as one of its
// controls — the Table's toolbar, the context tree's column — sized to the
// rows beside it rather than to the surface. `md` is the inline filter box
// that sits inside an already-busy panel; `lg` is for a surface where search
// is the primary action — it is taller, reads at 15px and carries a hairline
// so it stays legible sitting on a white toolbar rather than dissolving into
// it.

const SIZES = {
  sm: {
    frame: 'gap-1.5 rounded-md px-2 py-1',
    input: 'text-[13px]',
    icon: 'h-3.5 w-3.5',
    clear: 'h-3 w-3',
  },
  md: {
    frame: 'gap-2 rounded-lg px-3.5 py-2.5',
    input: 'text-sm',
    icon: 'h-4 w-4',
    clear: 'h-3.5 w-3.5',
  },
  lg: {
    frame: 'gap-2.5 rounded-xl px-4 py-3 border border-border-subtle',
    // A whole-pixel line: 15px at the default 1.5 is 22.5, which left the box
    // 48.5px tall and put everything centred beside it on a half pixel, where
    // Windows rendered small digits at two different baselines.
    input: 'text-[15px] leading-[22px]',
    icon: 'h-[18px] w-[18px]',
    clear: 'h-4 w-4',
  },
} as const;

const SearchIcon = ({ className }: { className: string }) => (
  <svg className={clsx('shrink-0 text-text-muted', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
  </svg>
);

const ClearIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  icon?: React.ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus = false,
  icon,
  size = 'md',
  className,
}: SearchInputProps) {
  const s = SIZES[size];
  return (
    <div
      className={clsx(
        'flex items-center bg-surface-1 ring-1 ring-border-subtle transition-[box-shadow,background-color]',
        'focus-within:ring-border-default',
        s.frame,
        className,
      )}
    >
      {icon ?? <SearchIcon className={s.icon} />}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={clsx(
          'flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none',
          s.input,
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-text-muted hover:text-text-primary"
          aria-label="Clear search"
        >
          <ClearIcon className={s.clear} />
        </button>
      )}
    </div>
  );
}
