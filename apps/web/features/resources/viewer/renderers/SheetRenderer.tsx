'use client';

import { useState } from 'react';
import SpreadsheetViewer from '../../components/SpreadsheetViewer';
import type { RendererProps } from './types';

/** A workbook or CSV, read by SheetJS in the browser: sheet tabs, cell comments and proposed changes. */
export default function SheetRenderer({ resource }: RendererProps) {
  const [cell, setCell] = useState<string | null>(null);
  if (!resource.rawUrl) return null;
  return (
    <div className="h-full overflow-auto bg-surface">
      <SpreadsheetViewer resourceId={resource.id} fileUrl={resource.rawUrl} selectedCell={cell} onCellSelect={(ref) => setCell(ref)} />
    </div>
  );
}
