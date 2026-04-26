import { getInitials, getAvatarColor } from '@/lib/avatarUtils';

const SIZE_CLASSES = {
  xs: 'h-6 w-6 text-[9px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-xs',
  /** Used in modals/chips for tight spaces */
  chip: 'h-7 w-7 text-[10px]',
  lg: 'h-11 w-11 text-base',
  xl: 'h-12 w-12 text-sm',
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
        className={`${cls} rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${cls} ${getAvatarColor(name)} ${className}`}
    >
      {getInitials(name)}
    </div>
  );
}
