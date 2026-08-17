'use client';

/**
 * Resource detail page — viewer-dominant layout. The file preview is the hero;
 * a sticky header carries breadcrumb + actions (Download / Pin / Share / Delete)
 * and a right-hand activity panel holds Comments, proposed Changes (spreadsheets),
 * and Details. Promoted from the resources-library quick-look drawer so every
 * file has a shareable URL.
 */

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSession } from '@/features/auth/lib/auth-client';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import PDFViewer from '@/features/resources/components/PDFViewer';
import ChangeProposalDialog from '@/features/resources/components/ChangeProposalDialog';
import {
  FileTypeIcon, FILE_BADGE, FILE_LABEL, getPinned, togglePin, DocxViewer,
} from '@/features/resources/components/resourceUi';
import { formatBytes } from '@/lib/utils';
import { formatDate, timeAgo as relativeTimeAgo } from '@/lib/date';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import Chip from '@/components/ui/Chip';
import type { Resource, ResourceComment, ResourceChange } from '@/lib/types';
import {
  Download, Share2, Trash2, Bookmark, MessageSquare, GitPullRequest, Info,
  Loader2, Check, X, ChevronLeft, Send,
} from 'lucide-react';

// xlsx parser is heavy (~400KB gzipped) and only needed when a spreadsheet is opened
const SpreadsheetViewer = dynamic(() => import('@/features/resources/components/SpreadsheetViewer'), { ssr: false });

type PanelTab = 'comments' | 'changes' | 'details';

interface Uploader {
  id: string;
  name: string;
  image?: string | null;
  personId?: string | null;
}

interface ResourceDetail {
  resource: Resource;
  uploader: Uploader | null;
  counts: { comments: number; changes: number; pendingChanges: number };
  viewer: { role: string | null };
}

/** Relative within a month, absolute beyond it. */
function timeAgo(iso: string): string {
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return days < 30 ? relativeTimeAgo(iso, { style: 'short' }) : formatDate(iso);
}

export default function ResourceDetailPage({ params }: { params: Promise<{ resourceId: string }> }) {
  const { resourceId: rawResourceId } = use(params);
  const resourceId = decodeURIComponent(rawResourceId);
  const router = useRouter();
  const { data: session } = useSession();
  const { isAdmin } = useSpace();

  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<PanelTab>('comments');

  // spreadsheet collaboration state
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [selectedCellValue, setSelectedCellValue] = useState('');
  const [showPropose, setShowPropose] = useState(false);
  const [changeKey, setChangeKey] = useState(0);

  const [comments, setComments] = useState<ResourceComment[]>([]);
  const [changes, setChanges] = useState<ResourceChange[]>([]);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(resourceId)}`);
      if (!res.ok) { setNotFound(true); return; }
      setDetail(await res.json());
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [resourceId]);

  const fetchComments = useCallback(() => {
    fetch(`/api/resources/${encodeURIComponent(resourceId)}/comments`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setComments)
      .catch(() => {});
  }, [resourceId]);

  const fetchChanges = useCallback(() => {
    fetch(`/api/resources/${encodeURIComponent(resourceId)}/changes`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setChanges)
      .catch(() => {});
  }, [resourceId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);
  useEffect(() => { fetchComments(); }, [fetchComments]);
  useEffect(() => { fetchChanges(); }, [fetchChanges]);
  useEffect(() => { setPinned(getPinned().includes(resourceId)); }, [resourceId]);

  const resource = detail?.resource ?? null;
  const isSpreadsheet = resource?.fileType === 'xlsx' || resource?.fileType === 'csv';
  const canReview = isAdmin || detail?.viewer.role === 'admin';
  const pendingCount = changes.filter((c) => c.status === 'pending').length;

  const handlePin = () => { togglePin(resourceId); setPinned(getPinned().includes(resourceId)); };

  const share = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };

  const handleDelete = async () => {
    if (!resource || !confirm(`Delete "${resource.name}"? This can't be undone.`)) return;
    await fetch(`/api/resources?id=${encodeURIComponent(resourceId)}`, { method: 'DELETE' });
    router.push('/resources');
  };

  const reviewChange = async (changeId: string, status: 'approved' | 'rejected') => {
    const res = await fetch(`/api/resources/${encodeURIComponent(resourceId)}/changes/${encodeURIComponent(changeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      fetchChanges();
      setChangeKey((k) => k + 1); // re-render the sheet with the applied overlay
    }
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-56px)] items-center justify-center text-sm text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading resource…
      </div>
    );
  }
  if (notFound || !resource) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <div className="text-5xl">📄</div>
        <p className="text-base font-semibold text-text-primary">Resource not found</p>
        <p className="text-sm text-text-muted">It may have been deleted, or you don&apos;t have access.</p>
        <Link href="/resources" className="mt-2 text-sm font-bold hover:underline text-brand-dark-green">Back to resources</Link>
      </div>
    );
  }

  const badge = FILE_BADGE[resource.fileType] ?? 'bg-gray-50 text-gray-600 border-gray-200';
  const label = FILE_LABEL[resource.fileType] ?? resource.fileType.toUpperCase();

  return (
    <div className="flex h-[calc(100dvh-56px)] w-full flex-col">
      {/* ── sticky header bar ── */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border-subtle bg-surface-1/85 backdrop-blur">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link href="/resources" className="inline-flex items-center gap-0.5 font-semibold text-text-muted hover:text-text-primary transition flex-none">
            <ChevronLeft className="w-4 h-4" /> Resources
          </Link>
          <span className="text-text-muted flex-none">/</span>
          <span className="font-semibold text-text-primary truncate">{resource.name}</span>
        </div>

        <div className="flex items-center gap-1.5 flex-none">
          {isSpreadsheet && selectedCell && (
            <button onClick={() => setShowPropose(true)}
                    className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-bold text-brand-dark-green bg-brand-light-bg border border-brand-green/40 hover:bg-brand-green/15 transition">
              <GitPullRequest className="w-4 h-4" /> Propose change · {selectedCell}
            </button>
          )}
          <a href={resource.fileUrl} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-2 h-9 px-3.5 rounded-xl text-[13px] font-bold text-white bg-brand-green hover:opacity-95 active:scale-[0.99] transition">
            <Download className="w-4 h-4" /> <span className="hidden sm:inline">Download</span>
          </a>
          <IconBtn title={pinned ? 'Unpin' : 'Pin'} onClick={handlePin} active={pinned}>
            <Bookmark className="w-4 h-4" fill={pinned ? 'currentColor' : 'none'} />
          </IconBtn>
          <IconBtn title={copied ? 'Copied!' : 'Copy link'} onClick={share}>
            <Share2 className="w-4 h-4" />
          </IconBtn>
          <IconBtn title="Delete" onClick={handleDelete} danger>
            <Trash2 className="w-4 h-4" />
          </IconBtn>
        </div>
      </div>

      {/* ── identity row ── */}
      <div className="flex items-center gap-4 px-4 sm:px-6 py-4">
        <FileTypeIcon type={resource.fileType} className="h-14 w-14 flex-none" />
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold text-text-primary font-title leading-tight truncate">{resource.name}</h1>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border flex-none ${badge}`}>{label}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-text-muted flex-wrap">
            {detail?.uploader && (
              <>
                <span className="inline-flex items-center gap-1.5">
                  {detail.uploader.image
                    ? <img src={detail.uploader.image} alt="" className="w-4 h-4 rounded-md object-cover" />
                    : <span className="w-4 h-4 rounded-md overflow-hidden"><PersonSilhouette /></span>}
                  Uploaded by{' '}
                  {detail.uploader.personId
                    ? <Link href={`/directory/${encodeURIComponent(detail.uploader.personId)}`} className="font-semibold text-text-secondary hover:underline">{detail.uploader.name}</Link>
                    : <span className="font-semibold text-text-secondary">{detail.uploader.name}</span>}
                </span>
                <span>·</span>
              </>
            )}
            <span>{new Date(resource.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            {resource.fileSize ? <><span>·</span><span>{formatBytes(resource.fileSize)}</span></> : null}
            <span>·</span>
            <button onClick={() => setTab('comments')} className="inline-flex items-center gap-1 font-semibold text-text-secondary hover:underline">
              <MessageSquare className="w-3 h-3" /> {comments.length}
            </button>
          </div>
        </div>
      </div>

      {/* ── body: viewer + activity panel ── */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row overflow-y-auto lg:overflow-hidden border-t border-border-subtle">
        {/* viewer */}
        <div className="flex flex-col flex-1 min-w-0 min-h-[60vh] lg:min-h-0 bg-surface-2">
          {resource.fileType === 'pdf' ? (
            <PDFViewer fileUrl={resource.fileUrl} />
          ) : resource.fileType === 'image' ? (
            <div className="flex flex-1 items-center justify-center overflow-auto p-8">
              <img src={resource.fileUrl} alt={resource.name} className="max-w-full max-h-full object-contain rounded-xl shadow" />
            </div>
          ) : resource.fileType === 'docx' ? (
            <div className="flex flex-1 overflow-hidden bg-surface-1"><DocxViewer resourceId={resource.id} /></div>
          ) : isSpreadsheet ? (
            <div className="flex-1 overflow-hidden flex flex-col bg-surface-1">
              <SpreadsheetViewer
                key={`${resource.id}-${changeKey}`}
                resourceId={resource.id}
                fileUrl={resource.fileUrl}
                onCellSelect={(ref: string, val: string) => { setSelectedCell(ref); setSelectedCellValue(val); }}
                selectedCell={selectedCell}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
              <FileTypeIcon type={resource.fileType} className="h-16 w-16" />
              <p className="text-sm font-semibold text-text-primary">{resource.name}</p>
              <p className="text-xs text-text-muted">No preview available for this file type.</p>
              <a href={resource.fileUrl} target="_blank" rel="noopener noreferrer"
                 className="mt-1 inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-white bg-brand-green hover:opacity-95 transition">
                <Download className="w-4 h-4" /> Download
              </a>
            </div>
          )}
        </div>

        {/* activity panel */}
        <aside className="flex flex-col w-full lg:w-[360px] flex-none border-t lg:border-t-0 lg:border-l border-border-subtle bg-surface-1 lg:min-h-0">
          <div className="flex gap-1 px-3 pt-2 border-b border-border-subtle">
            <PanelTabBtn active={tab === 'comments'} onClick={() => setTab('comments')}
                         icon={<MessageSquare className="w-3.5 h-3.5" />} label="Comments" count={comments.length} />
            {isSpreadsheet && (
              <PanelTabBtn active={tab === 'changes'} onClick={() => setTab('changes')}
                           icon={<GitPullRequest className="w-3.5 h-3.5" />} label="Changes" count={pendingCount} highlight={pendingCount > 0} />
            )}
            <PanelTabBtn active={tab === 'details'} onClick={() => setTab('details')}
                         icon={<Info className="w-3.5 h-3.5" />} label="Details" />
          </div>

          <div className="flex-1 lg:overflow-y-auto">
            {tab === 'comments' && (
              <CommentsTab
                comments={comments}
                selectedCell={selectedCell}
                onSelectCell={isSpreadsheet ? setSelectedCell : undefined}
                resourceId={resourceId}
                authorName={session?.user?.name ?? 'Anonymous'}
                onPosted={fetchComments}
              />
            )}
            {tab === 'changes' && isSpreadsheet && (
              <ChangesTab changes={changes} canReview={canReview} onReview={reviewChange} />
            )}
            {tab === 'details' && <DetailsTab resource={resource} uploader={detail?.uploader ?? null} />}
          </div>
        </aside>
      </div>

      {showPropose && selectedCell && (
        <ChangeProposalDialog
          resourceId={resource.id}
          cellRef={selectedCell}
          originalValue={selectedCellValue}
          onClose={() => setShowPropose(false)}
          onProposed={() => { setChangeKey((k) => k + 1); fetchChanges(); }}
        />
      )}
    </div>
  );
}

/* ── header icon button ───────────────────────────────────────────────────── */

function IconBtn({ title, onClick, active, danger, children }: {
  title: string; onClick: () => void; active?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button type="button" title={title} onClick={onClick}
            className={`h-9 w-9 grid place-items-center rounded-xl border transition ${
              active
                ? 'text-brand-dark-green bg-brand-light-bg border-brand-green/40'
                : danger
                  ? 'text-text-muted border-border-default hover:text-red-500 hover:bg-red-50 hover:border-red-200'
                  : 'text-text-muted border-border-default hover:text-text-primary hover:bg-surface-2'
            }`}>
      {children}
    </button>
  );
}

/* ── activity panel tabs ──────────────────────────────────────────────────── */

function PanelTabBtn({ active, onClick, icon, label, count, highlight }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number; highlight?: boolean;
}) {
  return (
    <button onClick={onClick}
            className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-semibold transition ${active ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
      {icon} {label}
      {count != null && count > 0 && (
        <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-bold ${
          highlight ? 'bg-amber-100 text-amber-700' : 'bg-surface-3 text-text-muted'
        }`}>
          {count}
        </span>
      )}
      {active && <span className="absolute left-2 right-2 bottom-0 h-[3px] rounded-t bg-brand-green" />}
    </button>
  );
}

function CommentsTab({ comments, selectedCell, onSelectCell, resourceId, authorName, onPosted }: {
  comments: ResourceComment[];
  selectedCell: string | null;
  onSelectCell?: (ref: string | null) => void;
  resourceId: string;
  authorName: string;
  onPosted: () => void;
}) {
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(resourceId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cellRef: selectedCell, author: authorName, content: text.trim() }),
      });
      if (res.ok) { setText(''); onPosted(); }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-4 space-y-3">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="text-3xl">💬</span>
            <p className="text-sm font-semibold text-text-primary">No comments yet</p>
            <p className="text-xs text-text-muted">Ask a question or leave a note for the space.</p>
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-2xl border border-border-subtle p-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-md overflow-hidden flex-none">
                  <PersonSilhouette />
                </span>
                <b className="text-[13px] font-bold text-text-primary truncate">{c.author}</b>
                <span className="text-[11px] text-text-muted ml-auto flex-none">{timeAgo(c.createdAt)}</span>
              </div>
              {c.cellRef && (
                <button onClick={() => onSelectCell?.(c.cellRef ?? null)} disabled={!onSelectCell}
                        className="mt-1.5 inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-bold bg-brand-light-bg text-brand-dark-green border border-brand-green/40 disabled:cursor-default">
                  {c.cellRef}
                </button>
              )}
              <p className="mt-1.5 text-[13px] text-text-secondary leading-relaxed whitespace-pre-line">{c.content}</p>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-border-subtle">
        {selectedCell && (
          <div className="flex items-center justify-between mb-2 text-[11px] text-text-muted">
            <span>Commenting on cell <b className="text-brand-dark-green">{selectedCell}</b></span>
            {onSelectCell && <button onClick={() => onSelectCell(null)} className="hover:text-text-primary">Clear</button>}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
                    placeholder="Add a comment…"
                    className="flex-1 px-3 py-2 border border-border-default rounded-xl bg-surface-1 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green transition" />
          <button onClick={post} disabled={posting || !text.trim()}
                  className="h-9 w-9 grid place-items-center rounded-xl text-white bg-brand-green hover:opacity-95 disabled:opacity-50 transition flex-none">
            {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangesTab({ changes, canReview, onReview }: {
  changes: ResourceChange[];
  canReview: boolean;
  onReview: (id: string, status: 'approved' | 'rejected') => void;
}) {
  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
        <span className="text-3xl">🔀</span>
        <p className="text-sm font-semibold text-text-primary">No proposed changes</p>
        <p className="text-xs text-text-muted">Select a cell in the spreadsheet to propose an edit.</p>
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3">
      {changes.map((c) => (
        <div key={c.id} className="rounded-2xl border border-border-subtle p-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-bold bg-brand-light-bg text-brand-dark-green border border-brand-green/40">
              {c.cellRef}
            </span>
            <StatusBadge status={c.status} />
            <span className="text-[11px] text-text-muted ml-auto">{timeAgo(c.createdAt)}</span>
          </div>
          <div className="mt-2 text-[13px]">
            {c.originalValue != null && c.originalValue !== '' && (
              <span className="line-through text-text-muted mr-2">{c.originalValue}</span>
            )}
            <b className="font-bold text-brand-dark-green">{c.proposedValue}</b>
          </div>
          {c.reason && <p className="mt-1 text-xs text-text-muted italic">&ldquo;{c.reason}&rdquo;</p>}
          {canReview && c.status === 'pending' && (
            <div className="flex gap-2 mt-2.5">
              <button onClick={() => onReview(c.id, 'approved')}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-bold text-white bg-brand-green hover:opacity-95 transition">
                <Check className="w-3.5 h-3.5" /> Approve
              </button>
              <button onClick={() => onReview(c.id, 'rejected')}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-bold text-text-secondary bg-surface-2 border border-border-default hover:bg-surface-3 transition">
                <X className="w-3.5 h-3.5" /> Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-green-50 text-green-700 border-green-200',
    rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-semibold border capitalize ${styles[status] ?? 'bg-surface-2 text-text-muted border-border-default'}`}>
      {status}
    </span>
  );
}

function DetailsTab({ resource, uploader }: { resource: Resource; uploader: Uploader | null }) {
  const meta = resource.metadata ?? {};
  return (
    <div className="p-4 flex flex-col gap-3">
      <DetailRow label="Type" value={FILE_LABEL[resource.fileType] ?? resource.fileType.toUpperCase()} />
      {resource.fileSize ? <DetailRow label="Size" value={formatBytes(resource.fileSize)} /> : null}
      <DetailRow label="Uploaded" value={new Date(resource.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })} />
      {uploader && (
        <div>
          <div className="text-xs text-text-muted mb-1">Uploaded by</div>
          <div className="flex items-center gap-2">
            {uploader.image
              ? <img src={uploader.image} alt="" className="w-6 h-6 rounded-md object-cover" />
              : <span className="w-6 h-6 rounded-md overflow-hidden"><PersonSilhouette /></span>}
            {uploader.personId
              ? <Link href={`/directory/${encodeURIComponent(uploader.personId)}`} className="text-sm font-semibold text-text-primary hover:underline">{uploader.name}</Link>
              : <span className="text-sm font-semibold text-text-primary">{uploader.name}</span>}
          </div>
        </div>
      )}
      {meta.originalFilename && <DetailRow label="Original filename" value={meta.originalFilename} />}
      {meta.sheetNames && meta.sheetNames.length > 0 && (
        <div>
          <div className="text-xs text-text-muted mb-1.5">Sheets</div>
          <div className="flex flex-wrap gap-1.5">
            {meta.sheetNames.map((s) => (
              <Chip key={s} tone="muted" size="md">{s}</Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-sm font-semibold text-text-primary break-words">{value}</div>
    </div>
  );
}
