'use client';

/**
 * Event actions bar (copy link, download ICS, export CSV, etc.)
 */

import { useState } from 'react';
import { copyToClipboard } from '@/lib/utils';
import type { NBEvent } from '@/lib/types';
import { Link2, Download, FileDown, ExternalLink } from 'lucide-react';

interface EventActionsProps {
  event: NBEvent;
  communityId: string;
  showGraphLink?: boolean;
}

export function EventActions({ event, communityId, showGraphLink = true }: EventActionsProps) {
  const [copyStatus, setCopyStatus] = useState<string>('');

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/events/${event.id}/rsvp`;
    const success = await copyToClipboard(url);
    if (success) {
      setCopyStatus('Copied!');
      setTimeout(() => setCopyStatus(''), 2000);
    } else {
      setCopyStatus('Failed to copy');
      setTimeout(() => setCopyStatus(''), 2000);
    }
  };

  const handleDownloadICS = () => {
    window.open(`/api/events/${event.id}/ics?communityId=${communityId}`, '_blank');
  };

  const handleExportCSV = () => {
    window.open(`/api/events/${event.id}/export.csv?communityId=${communityId}`, '_blank');
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={handleCopyLink}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green hover:bg-brand-light-bg transition-all"
      >
        <Link2 className="w-4 h-4" />
        {copyStatus || 'Copy RSVP Link'}
      </button>

      <button
        onClick={handleDownloadICS}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green hover:bg-brand-light-bg transition-all"
      >
        <Download className="w-4 h-4" />
        Download .ics
      </button>

      <button
        onClick={handleExportCSV}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green hover:bg-brand-light-bg transition-all"
      >
        <FileDown className="w-4 h-4" />
        Export CSV
      </button>

      {showGraphLink && (
        <a
          href={`/discover?focus=${event.id}`}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-brand-white bg-brand-green rounded-lg hover:opacity-90 transition-all shadow-sm"
        >
          <ExternalLink className="w-4 h-4" />
          Open in Graph
        </a>
      )}
    </div>
  );
}

