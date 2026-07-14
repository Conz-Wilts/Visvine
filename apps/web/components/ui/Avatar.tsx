import PersonSilhouette from './PersonSilhouette';

// Square avatars (rounded-xl/lg) — matches profile imagery across the app
// (directory, full-profile overlay, mutual-connection cards).
const SIZE_CLASSES = {
  xs: 'h-6 w-6 rounded-lg',
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-xl',
  /** Used in modals/chips for tight spaces */
  chip: 'h-7 w-7 rounded-lg',
  lg: 'h-11 w-11 rounded-xl',
  xl: 'h-12 w-12 rounded-xl',
};

interface AvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  /** Tint for the silhouette fallback. Defaults to brand green when omitted. */
  accentColor?: string;
  className?: string;
}

export default function Avatar({ name, imageUrl, size = 'md', accentColor, className = '' }: AvatarProps) {
  const cls = SIZE_CLASSES[size];
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={`${cls} object-cover shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={name}
      className={`shrink-0 overflow-hidden ${cls} ${className}`}
    >
      <PersonSilhouette color={accentColor} />
    </div>
  );
}
