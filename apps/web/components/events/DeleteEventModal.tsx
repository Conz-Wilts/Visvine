'use client';

/**
 * Delete event confirmation modal
 */

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface DeleteEventModalProps {
  eventTitle: string;
  eventId: string;
  communityId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteEventModal({
  eventTitle,
  eventId,
  communityId,
  onClose,
  onSuccess,
}: DeleteEventModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/events/${eventId}?communityId=${communityId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete event');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-brand-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="p-3 bg-brand-green/10 rounded-full">
            <AlertTriangle className="w-6 h-6 text-brand-green" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-brand-black mb-2">
              Delete Event
            </h3>
            <p className="text-sm text-brand-grey">
              Are you sure you want to delete <span className="font-semibold text-brand-black">{eventTitle}</span>? This action cannot be undone.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-brand-green/10 border border-brand-green/30">
            <p className="text-sm text-brand-green font-medium">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:bg-brand-light-bg hover:border-brand-green transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-semibold bg-brand-green rounded-lg hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ color: '#ffffff' }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Deleting...' : 'Delete Event'}
          </button>
        </div>
      </div>
    </div>
  );
}

