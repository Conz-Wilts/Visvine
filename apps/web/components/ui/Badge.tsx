import { clsx } from 'clsx';

type BadgeVariant = 'status' | 'tag' | 'score' | 'label' | 'type-chip' | 'table-type';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  /** Custom background color — only used with the `type-chip` variant */
  color?: string;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  /** Blue "Active"-style status badge */
  status: 'px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded',
  /** Brand-green rounded pill for community/discovery tags */
  tag: 'px-2.5 py-1 text-xs font-medium bg-brand-light-bg text-brand-green rounded-full',
  /** Green percentage match score */
  score: 'inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium',
  /** Small gray capsule label (e.g. "Not yet on platform") */
  label: 'rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500',
  /** Type chip with custom background color via `color` prop. Rounding matches
   *  the context panel's type chip (`rounded-md`) so both surfaces agree. */
  'type-chip': 'inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold',
  /** Bordered type badge used in tables */
  'table-type': 'inline-flex px-3 py-1 rounded-full text-xs font-medium border',
};

export default function Badge({ children, variant = 'label', color, className }: BadgeProps) {
  const baseClasses = VARIANT_CLASSES[variant];

  if (variant === 'type-chip' && color) {
    return (
      <span
        className={clsx(baseClasses, className)}
        style={{ backgroundColor: color, color: '#fff' }}
      >
        {children}
      </span>
    );
  }

  return (
    <span className={clsx(baseClasses, className)}>
      {children}
    </span>
  );
}
