import type { SVGProps } from 'react';
import { clsx } from 'clsx';
import { Icon as AppIcon } from '@/features/shared/icons';
import { resolveToolIconName, type ToolIconName } from '@/lib/icons/toolIcons';

export { TOOL_ICON_NAMES as ICON_NAMES } from '@/lib/icons/toolIcons';
export type IconName = ToolIconName;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, className, ...rest }: IconProps) {
  return <AppIcon name={resolveToolIconName(name) ?? 'ellipsis'} size={size} className={clsx('shrink-0', className)} {...rest} />;
}
