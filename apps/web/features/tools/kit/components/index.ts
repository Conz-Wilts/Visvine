/**
 * Kit 2's components — the app's own (@visvine/ui), and the data-bound pieces
 * @visvine/ui has no need of (tables over rows, boards, charts, markdown).
 * The names and props a kit-1 Tool used are kept, so porting one is a change
 * of `sdk:` and nothing else.
 */
export { Banner } from './Banner';
export type { BannerProps, BannerTone } from './Banner';
export { Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';
export { Card } from './Card';
export type { CardProps } from './Card';
export { Chip } from './Chip';
export type { ChipProps, ChipTone } from './Chip';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { Field } from './Field';
export type { FieldProps } from './Field';
export { ImageUpload } from './ImageUpload';
export type { ImageUploadProps } from './ImageUpload';
export { Input } from './Input';
export { Modal } from './Modal';
export type { ModalProps } from './Modal';
export type { InputProps } from './Input';
export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';
export { ResourceImage } from './ResourceImage';
export type { ResourceImageProps } from './ResourceImage';
export { Segmented } from './Segmented';
export type { SegmentedOption, SegmentedProps } from './Segmented';
export { Select } from './Select';
export type { SelectOption, SelectProps } from './Select';
export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
export { Stack } from './Stack';
export type { StackProps } from './Stack';
export { Table } from './Table';
export type { TableColumn, TableProps } from './Table';
export { Tabs } from './Tabs';
export type { TabItem, TabsProps } from './Tabs';
export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

// ── batteries (2026-08) ──
export { AreaChart, BarChart, CHART_COLOR_SLOTS, LineChart, PieChart, Recharts, useChartColors } from './charts';
export type { ChartProps, ChartSeries, PieChartProps } from './charts';
export { DataTable } from './DataTable';
export type { DataTableColumn, DataTableProps, DataTableSort, SortDirection } from './DataTable';
export { DatePicker } from './DatePicker';
export type { DatePickerProps } from './DatePicker';
export { Markdown } from './Markdown';
export type { MarkdownProps } from './Markdown';
export { KanbanBoard, KanbanCard, KanbanColumn } from './Kanban';
export type { KanbanBoardProps, KanbanCardProps, KanbanColumnProps, KanbanMove } from './Kanban';

// ── the app's own components (@visvine/ui) ──
export {
  Alert,
  Avatar,
  Checkbox,
  ConfirmDialog,
  IconButton,
  LoadingText,
  Menu,
  Row,
  SearchInput,
  SettingsSection,
  Skeleton,
  Toggle,
} from '@visvine/ui';
export type { MenuItem } from '@visvine/ui';
