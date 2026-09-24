import type { ComponentType } from 'react';
import type { IconProps } from '../icons';
import {
  FileArchiveIcon,
  FileCode2Icon,
  FileIcon,
  FileImageIcon,
  FileMusicIcon,
  FilePdfIcon,
  FilePlayIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  Link2Icon,
  PresentationIcon,
} from '../icons';

/** The families a resource is drawn as — the app's `ResourceKind`, mirrored. */
export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'text'
  | 'code'
  | 'archive'
  | 'link'
  | 'other';

export const FILE_GLYPH: Record<FileKind, ComponentType<IconProps>> = {
  image: FileImageIcon,
  video: FilePlayIcon,
  audio: FileMusicIcon,
  pdf: FilePdfIcon,
  doc: FileTextIcon,
  sheet: FileSpreadsheetIcon,
  slides: PresentationIcon,
  text: FileTextIcon,
  code: FileCode2Icon,
  archive: FileArchiveIcon,
  link: Link2Icon,
  other: FileIcon,
};

/** Wash and ink per kind (tokens `color.file.*`), written out so the classes exist. */
export const FILE_TONE: Record<FileKind, string> = {
  image: 'bg-file-image-wash text-file-image-fg',
  video: 'bg-file-video-wash text-file-video-fg',
  audio: 'bg-file-audio-wash text-file-audio-fg',
  pdf: 'bg-file-pdf-wash text-file-pdf-fg',
  doc: 'bg-file-doc-wash text-file-doc-fg',
  sheet: 'bg-file-sheet-wash text-file-sheet-fg',
  slides: 'bg-file-slides-wash text-file-slides-fg',
  text: 'bg-file-text-wash text-file-text-fg',
  code: 'bg-file-code-wash text-file-code-fg',
  archive: 'bg-file-archive-wash text-file-archive-fg',
  link: 'bg-file-link-wash text-file-link-fg',
  other: 'bg-file-other-wash text-file-other-fg',
};

/** How a kind is said, one word, for a meta line. */
export const FILE_KIND_LABEL: Record<FileKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  doc: 'Document',
  sheet: 'Spreadsheet',
  slides: 'Slides',
  text: 'Text',
  code: 'Code',
  archive: 'Archive',
  link: 'Link',
  other: 'File',
};

export function asFileKind(value: string | null | undefined): FileKind {
  return value && value in FILE_GLYPH ? (value as FileKind) : 'other';
}
