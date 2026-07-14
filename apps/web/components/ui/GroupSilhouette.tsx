import { BRAND_GREEN, GROUP_SILHOUETTE_PATH } from '@/lib/avatarUtils';

interface GroupSilhouetteProps {
  /** Fill colour of the silhouette (the accent/theme colour). Defaults to brand green. */
  color?: string;
  className?: string;
}

/**
 * Canonical avatar fallback for groups/organisations: a white cluster-of-people
 * silhouette on an accent/theme-coloured fill — the group counterpart to
 * <PersonSilhouette>, shown when no image is available. Fills its parent, so the
 * parent controls shape (rounding) and size.
 */
export default function GroupSilhouette({ color = BRAND_GREEN, className = '' }: GroupSilhouetteProps) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center ${className}`}
      style={{ backgroundColor: color }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="#ffffff"
        className="h-[62%] w-[62%]"
        aria-hidden="true"
      >
        <path d={GROUP_SILHOUETTE_PATH} />
      </svg>
    </div>
  );
}
