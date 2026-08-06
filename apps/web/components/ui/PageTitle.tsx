import { clsx } from 'clsx';

interface PageTitleProps {
  /** Main page heading text. */
  title: string;
  /** Optional supporting line shown under the title. */
  subtitle?: React.ReactNode;
  /** Extra classes for the outer wrapper (e.g. to tweak spacing per page). */
  className?: string;
}

/**
 * Canonical page heading for the main app pages (Directory, Resources, Events,
 * Communities, Discover…). Owns both the type scale and the positioning so every
 * page's title lands at the same size in the same spot. Pass `subtitle` for the
 * promo-style pages that need a supporting line.
 */
export default function PageTitle({ title, subtitle, className }: PageTitleProps) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-4 pt-6 pb-0 text-center sm:px-6', className)}>
      <h1 className="text-5xl font-normal tracking-tight text-text-primary font-title">{title}</h1>
      {subtitle && (
        <p className="mt-2 max-w-2xl text-base text-text-muted">{subtitle}</p>
      )}
    </div>
  );
}
