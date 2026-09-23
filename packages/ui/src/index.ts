// @visvine/ui — the shared React components. Every one paints with the design
// tokens (packages/tokens) and nothing else. DESIGN.md is the reference.

// Setup
export { UIProvider, useUIAdapters, type UILinkProps, type UIImageProps } from './UIProvider';

// Actions
export { default as Button } from './Button';

// Form controls
export { default as Input, inputBaseClass } from './Input';
export { default as Textarea } from './Textarea';
export { default as Select } from './Select';
export { default as Checkbox } from './Checkbox';
export { default as Toggle } from './Toggle';
export { default as SearchInput } from './SearchInput';
export { default as Field } from './Field';

// Overlays
export { default as Modal } from './Modal';
export { default as ConfirmDialog } from './ConfirmDialog';
export { useToasts, ToastHost, type Toast, type ToastApi, type ToastTone } from './Toast';
export {
  SEARCH_MENU_PANEL,
  SEARCH_MENU_ROW,
  searchMenuRowState,
  SearchMenuInput,
  SearchMenuList,
  SearchMenuEmpty,
  useSearchMenuCursor,
} from './SearchMenu';
export { DROPDOWN_TRIGGER_CLASS, DROPDOWN_TRIGGER_ACTIVE_STYLE, DROPDOWN_TRIGGER_IDLE_STYLE } from './Dropdown';

// Navigation
export { default as Tabs, type TabOption } from './Tabs';

// Display
export { default as Chip, chipClass, chipStyle, CHIP_ACCENT_HOVER, type ChipTone, type ChipSize } from './Chip';
export { default as Avatar } from './Avatar';
export { default as PersonSilhouette } from './PersonSilhouette';
export { default as TypeSilhouette } from './TypeSilhouette';
export { default as Alert } from './Alert';
export { default as Logo } from './Logo';

// Status
export { default as EmptyState } from './EmptyState';
export { default as PageError } from './PageError';
export { default as LoadingText } from './LoadingText';
export { default as Skeleton } from './Skeleton';
export { default as ContentReveal } from './ContentReveal';

// Layout
export { Stack, Row } from './Stack';
export { default as SettingsSection } from './SettingsSection';

// Foundations
export { IconBase, type IconProps } from './icons';
export { FOCUS_RING } from './focus';
export {
  VIEW_ENTER_MS,
  VIEW_ENTER_EASE,
  VIEW_ENTER_SHIFT_PX,
  TAB_MOTION,
  TAB_MOTION_MS,
  TAB_MOTION_EASE,
  TAB_SET_MOTION_MS,
  prefersReducedMotion,
} from './motion';
export { publishTabIndicator, useTabIndicatorHandoff, applyTabIndicator, type IndicatorRect } from './tabIndicatorHandoff';
export {
  THEME_ACCENT,
  PERSON_SILHOUETTE_PATH,
  NODE_GLYPH_PATHS,
  NODE_GLYPH_FILL_RULE,
  getInitials,
  type NodeGlyph,
} from './avatarGlyphs';
export { useEscapeKey } from './hooks/useEscapeKey';
