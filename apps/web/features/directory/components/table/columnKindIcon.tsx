// The glyph a column wears in its header and in the column menus: one per
// kind, so a header says what its cells hold before any of them are read.

import { createElement, type ComponentType } from 'react';
import {
  CalendarIcon,
  HashIcon,
  Link2Icon,
  ListIcon,
  MailIcon,
  MapPinIcon,
  SquareCheckIcon,
  TagIcon,
  TypeIcon,
  UserCheckIcon,
} from '@/features/shared/icons';
import type { TableColumn } from '@/lib/directory/table';

const BY_KIND: Record<string, ComponentType<{ className?: string }>> = {
  text: TypeIcon,
  number: HashIcon,
  date: CalendarIcon,
  select: ListIcon,
  checkbox: SquareCheckIcon,
  url: Link2Icon,
  email: MailIcon,
  location: MapPinIcon,
  tags: TagIcon,
  alias: UserCheckIcon,
};

export function ColumnKindIcon({ column, className }: { column: TableColumn; className?: string }) {
  return createElement(BY_KIND[column.kind] ?? TypeIcon, { className });
}
