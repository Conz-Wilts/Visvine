'use client';
import { useState, useEffect } from 'react';
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
    fetch(url).then(r => r.json()).then(setComments).catch(() => {});
  }, [resourceId, cellRef]);

  async function addComment() {
    if (!newComment.trim()) return;
    const res = await fetch(`/api/resources/${resourceId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellRef, author, content: newComment }),
    });
    if (res.ok) {
      const c = await res.json();
      setComments(prev => [...prev, c]);
      setNewComment('');
    }
  }

  return (
    <div className="flex flex-col h-full border-l border-gray-200 bg-gray-50 w-72 shrink-0">
      <div className="p-3 border-b border-gray-200">
        <h3 className="font-medium text-sm">{cellRef ? `Cell ${cellRef}` : 'Document'} Comments</h3>
        {cellRef && (
          <button onClick={onProposeChange} className="mt-1 text-xs text-blue-600 underline">
            Propose a change to this cell
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {comments.length === 0 && <p className="text-xs text-gray-400">No comments yet.</p>}
        {comments.map(c => (
          <div key={c.id} className="bg-white rounded p-2 shadow-sm text-xs">
            <p className="font-medium">{c.author}</p>
            <p className="text-gray-600 mt-1">{c.content}</p>
            <p className="text-gray-400 mt-1">{new Date(c.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-gray-200 space-y-2">
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
          placeholder="Your name"
          value={author}
          onChange={e => setAuthor(e.target.value)}
        />
        <textarea
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs resize-none"
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
