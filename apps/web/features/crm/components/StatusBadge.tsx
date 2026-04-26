"use client";

interface StatusBadgeProps {
  isActive: boolean;
}

export function StatusBadge({ isActive }: StatusBadgeProps) {
  return isActive ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-500/20">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
      Shadow
    </span>
  );
}
