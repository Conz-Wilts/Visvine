'use client';
import { useState, useEffect } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import type { ResourceComment } from '@/lib/types';

export default function CommentsPanel({
  resourceId,
  cellRef,
  onProposeChange,
}: {
  resourceId: string;
  cellRef: string | null;
  onProposeChange: () => void;
}) {
  const [comments, setComments] = useState<ResourceComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [author, setAuthor] = useState('Anonymous');

  useEffect(() => {
    if (!resourceId) return;
    const url = `/api/resources/${resourceId}/comments${cellRef ? `?cellRef=${encodeURIComponent(cellRef)}` : ''}`;
    fetchJson<ResourceComment[]>(url).then(setComments).catch(() => {});
  }, [resourceId, cellRef]);

  async function addComment() {
    if (!newComment.trim()) return;
    try {
      const c = await fetchJsonBody<ResourceComment>(`/api/resources/${resourceId}/comments`, 'POST', { cellRef, author, content: newComment });
      setComments(prev => [...prev, c]);
      setNewComment('');
    } catch { /* the composer keeps the text for a retry */ }
  }

  return (
    <div className="flex flex-col h-full border-l border-border-subtle bg-surface-2 w-72 shrink-0">
      <div className="p-3 border-b border-border-subtle">
        <h3 className="font-medium text-sm">{cellRef ? `Cell ${cellRef}` : 'Document'} Comments</h3>
        {cellRef && (
          <button onClick={onProposeChange} className="mt-1 text-xs text-blue-600 underline">
            Propose a change to this cell
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {comments.length === 0 && <p className="text-xs text-text-muted">No comments yet.</p>}
        {comments.map(c => (
          <div key={c.id} className="bg-surface-1 rounded p-2 text-xs">
            <p className="font-medium">{c.author}</p>
            <p className="text-text-muted mt-1">{c.content}</p>
            <p className="text-text-muted mt-1">{new Date(c.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-border-subtle space-y-2">
        <input
          className="w-full border border-border-default rounded px-2 py-1 text-xs"
          placeholder="Your name"
          value={author}
          onChange={e => setAuthor(e.target.value)}
        />
        <textarea
          className="w-full border border-border-default rounded px-2 py-1 text-xs resize-none"
          rows={3}
          placeholder="Add a comment..."
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
        />
        <button
          onClick={addComment}
          className="w-full bg-blue-600 text-white text-xs rounded py-1 hover:bg-blue-700"
        >
          Add Comment
        </button>
      </div>
    </div>
  );
}
