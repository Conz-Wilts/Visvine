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

/**
 * Lucide names a model reaches for that this set draws as a near glyph. Not
 * listed as names — a Tool's code is told the real ones — only accepted, so a
 * guessed `utensils` or `check-circle` lands on something close, not an error.
 */
const NEAREST: Record<string, IconName> = {
  'check-circle': 'circle-check', 'check-circle-2': 'circle-check', 'circle-check-big': 'circle-check', 'badge-check': 'circle-check',
  'check-square': 'square-check', 'list-checks': 'square-check', 'list-todo': 'square-check', 'clipboard-check': 'clipboard-list', 'clipboard': 'clipboard-list',
  'alert-triangle': 'triangle-alert', 'alert-circle': 'info', 'help-circle': 'circle-question-mark',
  'utensils': 'pizza', 'utensils-crossed': 'pizza', 'chef-hat': 'pizza', 'cooking-pot': 'pizza', 'soup': 'pizza', 'salad': 'sprout', 'cup-soda': 'coffee',
  'bar-chart': 'tool-chart', 'bar-chart-2': 'tool-chart', 'bar-chart-3': 'tool-chart', 'chart-bar': 'tool-chart', 'chart-column': 'tool-chart', 'line-chart': 'trending-up', 'chart-line': 'trending-up',
  'pie-chart': 'tool-chart', 'chart-pie': 'tool-chart', 'activity': 'trending-up', 'gauge': 'tool-chart', 'layout-dashboard': 'layout-grid', 'kanban': 'tool-kanban', 'kanban-square': 'tool-kanban', 'square-kanban': 'tool-kanban',
  'goal': 'target', 'crosshair': 'target', 'circle-dot': 'target', 'award': 'trophy', 'medal': 'trophy', 'crown': 'trophy', 'thumbs-up': 'heart', 'heart-handshake': 'handshake', 'party': 'party-popper',
  'wallet': 'coins', 'credit-card': 'coins', 'piggy-bank': 'coins', 'banknote': 'coins', 'receipt': 'file-text', 'badge-dollar-sign': 'dollar-sign', 'circle-dollar-sign': 'dollar-sign', 'hand-coins': 'coins',
  'shopping-cart': 'package', 'shopping-bag': 'package', 'truck': 'package', 'warehouse': 'package', 'boxes': 'package', 'archive': 'file-archive', 'store': 'building',
  'building-2': 'building', 'landmark': 'building', 'factory': 'building', 'briefcase-business': 'briefcase',
  'users-2': 'users', 'user-round': 'user', 'contact': 'user', 'contact-round': 'user', 'id-card': 'user', 'user-search': 'users', 'user-round-plus': 'user-plus', 'user-cog': 'user',
  'graduation-cap': 'book-open', 'library': 'book-open', 'book-marked': 'bookmark', 'notebook': 'file-text', 'notebook-pen': 'pencil', 'scroll-text': 'file-text', 'file-check': 'file-text', 'files': 'file',
  'pen': 'pencil', 'pen-line': 'pencil', 'pencil-line': 'pencil', 'square-pen': 'pencil', 'edit-3': 'pencil',
  'calendar-days': 'calendar', 'calendar-clock': 'calendar', 'calendar-range': 'calendar', 'timer': 'clock', 'alarm-clock': 'clock', 'hourglass': 'clock', 'history': 'rotate-ccw', 'repeat': 'refresh-cw',
  'dumbbell': 'flame', 'heart-pulse': 'heart', 'bike': 'flame', 'footprints': 'flame', 'leaf': 'sprout', 'flower': 'sprout', 'tree': 'sprout',
  'ticket': 'tag', 'tags': 'tag', 'bookmark-check': 'bookmark', 'headphones': 'music', 'life-buoy': 'info', 'message-square-text': 'message-square', 'messages-square': 'message-square',
  'plane': 'map-pin', 'map': 'map-pin', 'navigation': 'compass', 'bug-off': 'bug', 'wrench': 'hammer', 'server': 'network', 'database': 'table', 'sheet': 'table', 'table-2': 'table',
  'sparkle': 'sparkles', 'wand': 'sparkles', 'wand-2': 'sparkles', 'lightning': 'zap', 'bell-ring': 'bell', 'shield': 'shield-check', 'lock-keyhole': 'lock', 'key': 'key-round',
}

export type ToolIconName = IconName | keyof typeof ALIASES;

export const TOOL_ICON_NAMES: ToolIconName[] = [...ICON_NAMES, ...Object.keys(ALIASES) as Array<keyof typeof ALIASES>];

export function resolveToolIconName(name: string): IconName | null {
  if (isIconName(name)) return name;
  if (Object.hasOwn(ALIASES, name)) return ALIASES[name as keyof typeof ALIASES];
  const normalized = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase().replace(/-icon$/, '');
  if (isIconName(normalized)) return normalized;
  if (Object.hasOwn(ALIASES, normalized)) return ALIASES[normalized as keyof typeof ALIASES];
  if (Object.hasOwn(NEAREST, normalized)) return NEAREST[normalized];
  // Lucide's renames: `check-circle` became `circle-check`; `-2` / `-big` are variants of one glyph.
  const parts = normalized.split('-');
  if (parts.length === 2 && isIconName(`${parts[1]}-${parts[0]}`)) return `${parts[1]}-${parts[0]}` as IconName;
  const base = normalized.replace(/-(?:\d+|big|round|square|circle)$/, '');
  return base !== normalized ? resolveToolIconName(base) : null;
}
