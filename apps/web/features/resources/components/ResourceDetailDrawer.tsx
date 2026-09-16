'use client';
import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from '@/features/shared/components/SpaceLink';
import PDFViewer from '@/features/resources/components/PDFViewer';
import CommentsPanel from '@/features/resources/components/CommentsPanel';
import ChangeProposalDialog from '@/features/resources/components/ChangeProposalDialog';
import { FileTypeIcon, FILE_LABEL, DocxViewer, FileUnavailable } from '@/features/resources/components/resourceUi';
import { formatBytes } from '@/lib/utils';
import type { Resource } from '@/lib/types';

// xlsx parser is heavy (~400KB gzipped) and only needed when a spreadsheet is opened
const SpreadsheetViewer = dynamic(() => import('@/features/resources/components/SpreadsheetViewer'), { ssr: false });

export default function ResourceDetailDrawer({
  resource,
  pinned,
  onClose,
  onTogglePin,
  onDelete,
}: {
  resource: Resource | null;
  pinned: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const isOpen = resource !== null;
  const [displayResource, setDisplayResource] = useState<Resource | null>(resource);
  const [isContentVisible, setIsContentVisible] = useState(true);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [selectedCellValue, setSelectedCellValue] = useState('');
  const [showPropose, setShowPropose] = useState(false);
  const [changeKey, setChangeKey] = useState(0);

  // Cross-fade content when switching resources
  useEffect(() => {
    if (resource?.id === displayResource?.id) return;
    if (resource === null) {
      setDisplayResource(null);
      setIsContentVisible(true);
    } else if (displayResource === null) {
      setDisplayResource(resource);
      setSelectedCell(null);
      setIsContentVisible(true);
    } else {
      setIsContentVisible(false);
      const t = setTimeout(() => {
        setDisplayResource(resource);
        setSelectedCell(null);
        setIsContentVisible(true);
      }, 180);
      return () => clearTimeout(t);
    }
  }, [resource, displayResource]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Click-outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) onClose();
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 100);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler); };
  }, [isOpen, onClose]);

  const isSpreadsheet = displayResource?.fileType === 'xlsx' || displayResource?.fileType === 'csv';

  return (
    <>
      <aside
        ref={drawerRef}
        className={`fixed top-0 right-0 h-full bg-surface-1 shadow-float z-50 transition-all duration-300 ease-in-out
          flex flex-col overflow-hidden
          w-full sm:w-[520px]
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {displayResource && (
          <div className={`h-full flex flex-col transition-opacity duration-180 ${isContentVisible ? 'opacity-100' : 'opacity-0'}`}>

            {/* Drawer header */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 bg-glass-float border-b border-border-subtle">
              <div className="flex min-w-0 items-center gap-3">
                <FileTypeIcon type={displayResource.fileType} className="h-9 w-9 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary leading-tight">{displayResource.name}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {FILE_LABEL[displayResource.fileType] ?? displayResource.fileType.toUpperCase()}
                    {displayResource.fileSize ? ` · ${formatBytes(displayResource.fileSize)}` : ''}
                    {` · ${new Date(displayResource.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Link
                  href={`/resources/${encodeURIComponent(displayResource.id)}`}
                  title="Open full page"
                  className="rounded-lg p-2 text-text-muted hover:bg-surface-3 hover:text-text-secondary transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </Link>
                {isSpreadsheet && selectedCell && (
                  <button
                    type="button"
                    onClick={() => setShowPropose(true)}
                    className="flex items-center gap-1.5 rounded-md border border-brand-green/40 bg-brand-green/5 px-3 py-1.5 text-xs font-semibold text-brand-green hover:bg-brand-green/10 transition-colors"
                  >
                    Propose Change
                  </button>
                )}
                <button
                  type="button"
                  onClick={onTogglePin}
                  title={pinned ? 'Unpin' : 'Pin'}
                  className={`rounded-lg p-2 transition-colors ${pinned ? 'text-brand-green hover:bg-brand-green/10' : 'text-text-muted hover:bg-surface-3 hover:text-text-secondary'}`}
                >
                  <svg className="h-4 w-4" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  title="Delete"
                  className="rounded-lg p-2 text-text-muted hover:bg-red-50 hover:text-red-500 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-2 text-text-muted hover:bg-surface-3 hover:text-text-secondary transition-colors"
                  aria-label="Close"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Drawer body */}
            <div className="flex flex-1 overflow-hidden">
              {displayResource.fileType === 'docx' ? (
                <DocxViewer resourceId={displayResource.id} />
              ) : !displayResource.fileUrl ? (
                <FileUnavailable />
              ) : displayResource.fileType === 'pdf' ? (
                <PDFViewer fileUrl={displayResource.fileUrl} />
              ) : displayResource.fileType === 'image' ? (
                <div className="flex flex-1 items-center justify-center overflow-auto bg-surface-2 p-8">
                  <img
                    src={displayResource.fileUrl}
                    alt={displayResource.name}
                    className="max-w-full max-h-full object-contain rounded-xl shadow"
                  />
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-hidden flex flex-col">
                    <SpreadsheetViewer
                      key={`${displayResource.id}-${changeKey}`}
                      resourceId={displayResource.id}
                      fileUrl={displayResource.fileUrl}
                      onCellSelect={(ref: string, val: string) => { setSelectedCell(ref); setSelectedCellValue(val); }}
                      selectedCell={selectedCell}
                    />
                  </div>
                  <CommentsPanel
                    resourceId={displayResource.id}
                    cellRef={selectedCell}
                    onProposeChange={() => setShowPropose(true)}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </aside>

      {showPropose && selectedCell && displayResource && (
        <ChangeProposalDialog
          resourceId={displayResource.id}
          cellRef={selectedCell}
          originalValue={selectedCellValue}
          onClose={() => setShowPropose(false)}
          onProposed={() => setChangeKey(k => k + 1)}
        />
      )}
    </>
  );
}

