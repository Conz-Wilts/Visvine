'use client';
import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useResources } from '@/hooks/useResources';
import ResourceUploadDialog from '@/components/resources/ResourceUploadDialog';
import PDFViewer from '@/components/resources/PDFViewer';
import CommentsPanel from '@/components/resources/CommentsPanel';
import ChangeProposalDialog from '@/components/resources/ChangeProposalDialog';
import type { Resource } from '@/lib/types';

// xlsx parser is heavy (~400KB gzipped) and only needed when a spreadsheet is opened
const SpreadsheetViewer = dynamic(() => import('@/components/resources/SpreadsheetViewer'), { ssr: false });

type ResourceTab = 'all' | 'pinned' | 'new';

const PINNED_KEY = 'nb_pinned_resources';
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getPinned(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]'); } catch { return []; }
}
function togglePin(id: string) {
  const list = getPinned();
  const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  localStorage.setItem(PINNED_KEY, JSON.stringify(next));
}

// ─── File type helpers ────────────────────────────────────────────────────────

const FILE_BG: Record<string, string> = {
  pdf:   'bg-red-100 text-red-600',
  xlsx:  'bg-green-100 text-green-600',
  csv:   'bg-emerald-100 text-emerald-600',
  docx:  'bg-blue-100 text-blue-600',
  image: 'bg-purple-100 text-purple-600',
};

const FILE_BADGE: Record<string, string> = {
  pdf:   'bg-red-50 text-red-700 border-red-200',
  xlsx:  'bg-green-50 text-green-700 border-green-200',
  csv:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  docx:  'bg-blue-50 text-blue-700 border-blue-200',
  image: 'bg-purple-50 text-purple-700 border-purple-200',
};

const FILE_LABEL: Record<string, string> = {
  pdf: 'PDF', xlsx: 'Spreadsheet', csv: 'CSV', docx: 'Document', image: 'Image',
};

function FileTypeIcon({ type, className = '' }: { type: string; className?: string }) {
  const colors = FILE_BG[type] ?? 'bg-gray-100 text-gray-500';
  const iconClass = 'h-5 w-5';
  const content = type === 'image' ? (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ) : type === 'pdf' ? (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ) : type === 'docx' ? (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ) : (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  );
  return (
    <div className={`flex items-center justify-center rounded-xl ${colors} ${className}`}>
      {content}
    </div>
  );
}

function formatBytes(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Docx viewer ─────────────────────────────────────────────────────────────

function DocxViewer({ resourceId }: { resourceId: string }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setHtml('');
    fetch(`/api/resources/${resourceId}/docx-preview`)
      .then(r => r.text())
      .then(h => { setHtml(h); setLoading(false); })
      .catch(() => setLoading(false));
  }, [resourceId]);

  if (loading) return (
    <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-green mr-3" />
      Loading preview…
    </div>
  );
  return <div className="flex-1 overflow-auto p-6 prose max-w-none text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Resource grid card ───────────────────────────────────────────────────────

function ResourceCard({
  resource,
  selected,
  pinned,
  visible,
  onSelect,
  onTogglePin,
  onDelete,
}: {
  resource: Resource;
  selected: boolean;
  pinned: boolean;
  visible: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const bg = (FILE_BG[resource.fileType] ?? 'bg-gray-100 text-gray-400').split(' ')[0];
  const badge = FILE_BADGE[resource.fileType] ?? 'bg-gray-50 text-gray-600 border-gray-200';
  const label = FILE_LABEL[resource.fileType] ?? resource.fileType.toUpperCase();

  return (
    <div
      className="transition-all duration-500 ease-out"
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(16px)' }}
    >
      <div
        onClick={onSelect}
        className={`relative bg-surface-1 rounded-2xl border overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group ${
          selected
            ? 'border-brand-green ring-2 ring-brand-green/20'
            : 'border-border-subtle hover:border-border-default'
        }`}
      >
        {/* Pin button */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onTogglePin(); }}
          title={pinned ? 'Unpin' : 'Pin'}
          className={`absolute top-2.5 right-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-full shadow-sm transition-all ${
            pinned
              ? 'bg-brand-green text-white'
              : 'bg-surface-1/90 text-text-muted opacity-0 group-hover:opacity-100 hover:text-brand-green'
          }`}
        >
          <svg className="h-3.5 w-3.5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </button>

        {/* Preview area */}
        {resource.fileType === 'image' ? (
          <div className="aspect-[4/3] overflow-hidden">
            <img src={resource.fileUrl} alt={resource.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          </div>
        ) : (
          <div className={`aspect-[4/3] flex items-center justify-center ${bg} group-hover:brightness-95 transition-all`}>
            <FileTypeIcon type={resource.fileType} className="h-16 w-16" />
          </div>
        )}

        {/* Meta */}
        <div className="p-4">
          <h3 className="font-semibold text-text-primary text-sm leading-snug mb-2.5 line-clamp-2">{resource.name}</h3>
          <div className="flex items-center justify-between">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${badge}`}>{label}</span>
            <div className="flex items-center gap-2">
              {resource.fileSize ? <span className="text-xs text-text-muted">{formatBytes(resource.fileSize)}</span> : null}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onDelete(); }}
                className="rounded-md p-1 text-text-muted/40 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                title="Delete"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            {new Date(resource.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Resource detail drawer ───────────────────────────────────────────────────

function ResourceDetailDrawer({
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
        className={`fixed top-0 right-0 h-full bg-surface-1 shadow-2xl z-50 transition-all duration-300 ease-in-out
          flex flex-col overflow-hidden
          w-full sm:w-[520px]
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {displayResource && (
          <div className={`h-full flex flex-col transition-opacity duration-180 ${isContentVisible ? 'opacity-100' : 'opacity-0'}`}>

            {/* Drawer header */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 bg-surface-1 border-b border-border-subtle">
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
                {isSpreadsheet && selectedCell && (
                  <button
                    type="button"
                    onClick={() => setShowPropose(true)}
                    className="flex items-center gap-1.5 rounded-full border border-brand-green/40 bg-brand-green/5 px-3 py-1.5 text-xs font-semibold text-brand-green hover:bg-brand-green/10 transition-colors"
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
              {displayResource.fileType === 'pdf' ? (
                <PDFViewer fileUrl={displayResource.fileUrl} />
              ) : displayResource.fileType === 'image' ? (
                <div className="flex flex-1 items-center justify-center overflow-auto bg-surface-2 p-8">
                  <img
                    src={displayResource.fileUrl}
                    alt={displayResource.name}
                    className="max-w-full max-h-full object-contain rounded-xl shadow"
                  />
                </div>
              ) : displayResource.fileType === 'docx' ? (
                <DocxViewer resourceId={displayResource.id} />
              ) : (
                <>
                  <div className="flex-1 overflow-hidden flex flex-col">
                    <SpreadsheetViewer
                      key={`${displayResource.id}-${changeKey}`}
                      resourceId={displayResource.id}
                      fileUrl={displayResource.fileUrl}
                      onCellSelect={(ref, val) => { setSelectedCell(ref); setSelectedCellValue(val); }}
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

// ─── Staggered grid ───────────────────────────────────────────────────────────

function ResourceGrid({
  resources,
  pinned,
  selected,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  resources: Resource[];
  pinned: string[];
  selected: Resource | null;
  onSelect: (r: Resource) => void;
  onDelete: (r: Resource) => void;
  onTogglePin: (id: string) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(0);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevKeyRef = useRef('');

  useEffect(() => {
    const key = resources.map(r => r.id).join(',');
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setVisibleCount(0);
    resources.forEach((_, i) => {
      const t = setTimeout(() => setVisibleCount(i + 1), i * 50);
      timeoutsRef.current.push(t);
    });
    return () => timeoutsRef.current.forEach(clearTimeout);
  }, [resources]);

  if (!resources.length) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center p-12">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-surface-3">
          <svg className="h-10 w-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <p className="text-base font-semibold text-text-secondary">No resources here</p>
          <p className="mt-1 text-sm text-text-muted">Upload a file to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 p-6">
      {resources.map((r, i) => (
        <ResourceCard
          key={r.id}
          resource={r}
          selected={selected?.id === r.id}
          pinned={pinned.includes(r.id)}
          visible={i < visibleCount}
          onSelect={() => onSelect(r)}
          onTogglePin={() => onTogglePin(r.id)}
          onDelete={() => onDelete(r)}
        />
      ))}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS: { id: ResourceTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'new', label: 'New' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const { currentCommunity } = useCommunity();
  const { resources, loading, refetch } = useResources(currentCommunity?.id ?? null);
  const [tab, setTab] = useState<ResourceTab>('all');
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState<string[]>([]);
  const [selected, setSelected] = useState<Resource | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => { setPinned(getPinned()); }, []);

  function handleTogglePin(id: string) {
    togglePin(id);
    setPinned(getPinned());
  }

  async function handleDelete(r: Resource) {
    if (!confirm(`Delete "${r.name}"?`)) return;
    await fetch(`/api/resources?id=${r.id}`, { method: 'DELETE' });
    if (selected?.id === r.id) setSelected(null);
    refetch();
  }

  const filteredResources = resources.filter(r => {
    if (tab === 'pinned' && !pinned.includes(r.id)) return false;
    if (tab === 'new' && Date.now() - new Date(r.createdAt).getTime() >= ONE_WEEK_MS) return false;
    if (search.trim()) return r.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  if (!currentCommunity) {
    return (
      <div className="flex h-[calc(100dvh-56px)] w-full items-center justify-center">
        <p className="text-text-muted">Select a community to view resources.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-56px)] w-full flex-col">

      {/* ── Page header ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 px-6 pt-6 pb-3">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-4xl font-normal tracking-tight text-text-primary font-ginto">Resources</h1>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 rounded-full bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity active:scale-95"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Upload
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="flex items-center gap-2 rounded-full bg-surface-3 px-3.5 py-2 flex-1 max-w-sm">
            <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search resources…"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-text-muted hover:text-text-secondary">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-full bg-surface-3 p-1">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                  tab === t.id
                    ? 'bg-surface-1 text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Count */}
          {!loading && (
            <span className="text-xs text-text-muted ml-1">
              {filteredResources.length} {filteredResources.length === 1 ? 'file' : 'files'}
            </span>
          )}
        </div>
      </div>

      {/* ── Grid ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 p-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border-subtle overflow-hidden">
                <div className="aspect-[4/3] animate-pulse bg-surface-3" />
                <div className="p-4 space-y-2">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-3" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-surface-3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ResourceGrid
            resources={filteredResources}
            pinned={pinned}
            selected={selected}
            onSelect={r => setSelected(r)}
            onDelete={handleDelete}
            onTogglePin={handleTogglePin}
          />
        )}
      </div>

      {/* ── Detail drawer (slides in from right) ───────────────────── */}
      <ResourceDetailDrawer
        resource={selected}
        pinned={selected ? pinned.includes(selected.id) : false}
        onClose={() => setSelected(null)}
        onTogglePin={() => selected && handleTogglePin(selected.id)}
        onDelete={() => selected && handleDelete(selected)}
      />

      {/* ── Upload dialog ────────────────────────────────────────────── */}
      {showUpload && (
        <ResourceUploadDialog
          communityId={currentCommunity.id}
          onClose={() => setShowUpload(false)}
          onUploaded={refetch}
        />
      )}
    </div>
  );
}
