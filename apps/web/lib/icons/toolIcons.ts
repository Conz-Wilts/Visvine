import { ICON_NAMES, isIconName, type IconName } from './names';

const ALIASES = {
  filter: 'list-filter',
  trash: 'trash-2',
  edit: 'pencil',
  dollar: 'dollar-sign',
  chart: 'tool-chart',
  trend: 'trending-up',
  board: 'tool-kanban',
  link: 'link-2',
  message: 'message-square',
  box: 'package',
  bolt: 'zap',
  book: 'book-open',
  home: 'house',
  arrowRight: 'arrow-right',
  arrowUp: 'arrow-up',
  arrowDown: 'arrow-down',
  chevronLeft: 'chevron-left',
  chevronRight: 'chevron-right',
  more: 'ellipsis',
} as const satisfies Record<string, IconName>;

export type ToolIconName = IconName | keyof typeof ALIASES;

export const TOOL_ICON_NAMES: ToolIconName[] = [...ICON_NAMES, ...Object.keys(ALIASES) as Array<keyof typeof ALIASES>];

export function resolveToolIconName(name: string): IconName | null {
  if (isIconName(name)) return name;
  if (Object.hasOwn(ALIASES, name)) return ALIASES[name as keyof typeof ALIASES];
  const normalized = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
  if (isIconName(normalized)) return normalized;
  return Object.hasOwn(ALIASES, normalized) ? ALIASES[normalized as keyof typeof ALIASES] : null;
}
