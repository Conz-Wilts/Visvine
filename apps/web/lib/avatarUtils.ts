/**
 * Shared avatar utility functions used across messaging, directory, and community components.
 */

const AVATAR_PALETTE = [
  'bg-blue-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500',
  'bg-teal-500', 'bg-brand-green',
];

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
