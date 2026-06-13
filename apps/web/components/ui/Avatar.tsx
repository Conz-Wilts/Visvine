import { getInitials, getAvatarColor } from '@/lib/avatarUtils';

// Square avatars (rounded-xl/lg) — matches profile imagery across the app
// (directory, full-profile overlay, mutual-connection cards).
const SIZE_CLASSES = {
  xs: 'h-6 w-6 text-[9px] rounded-lg',
  sm: 'h-8 w-8 text-xs rounded-lg',
  md: 'h-9 w-9 text-xs rounded-xl',
  /** Used in modals/chips for tight spaces */
  chip: 'h-7 w-7 text-[10px] rounded-lg',
  lg: 'h-11 w-11 text-base rounded-xl',
  xl: 'h-12 w-12 text-sm rounded-xl',
};

interface AvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}

export default function Avatar({ name, imageUrl, size = 'md', className = '' }: AvatarProps) {
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
      className={`flex shrink-0 items-center justify-center font-semibold text-white ${cls} ${getAvatarColor(name)} ${className}`}
    >
      {getInitials(name)}
    </div>
  );
}
