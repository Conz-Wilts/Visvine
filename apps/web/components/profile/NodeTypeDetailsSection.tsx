'use client';

import React from 'react';
import type { NBNode } from '@/lib/types';

interface Props {
  node: NBNode;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs font-medium text-brand-grey uppercase tracking-wide whitespace-nowrap">{label}</span>
      <span className="text-sm text-brand-black text-right">{value}</span>
    </div>
  );
}

export default function NodeTypeDetailsSection({ node }: Props) {
  const meta = node.metadata ?? {};

  switch (node.type) {
    case 'People':
      return (
        <div>
          <DetailRow label="Pronouns" value={meta.pronouns as string} />
          <DetailRow label="Organization" value={meta.organization as string} />
        </div>
      );

    case 'Startup':
      return (
        <div>
          <DetailRow label="Stage" value={meta.stage as string} />
          <DetailRow label="Industry" value={meta.industry as string} />
          <DetailRow label="Founded" value={meta.founded as string} />
          {Boolean(meta.hiring) && (
            <div className="py-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                We&apos;re Hiring
              </span>
            </div>
          )}
        </div>
      );

    case 'Investor':
      return (
        <div>
          <DetailRow label="Investment Stage" value={meta.investmentStage as string} />
          <DetailRow label="Sector Focus" value={meta.sectorFocus as string} />
          <DetailRow label="Portfolio Count" value={meta.portfolioCount as string} />
          <DetailRow label="Check Size" value={meta.checkSize as string} />
        </div>
      );

    case 'Organization':
      return (
        <div>
          <DetailRow label="Founded" value={meta.founded as string} />
          <DetailRow label="HQ" value={node.location} />
          <DetailRow label="Mission" value={meta.mission as string} />
          <DetailRow label="Members" value={meta.memberCount as string} />
        </div>
      );

    case 'Group':
      return (
        <div>
          <DetailRow label="Group Type" value={meta.groupType as string} />
          <DetailRow label="Membership" value={meta.membership as string} />
          <DetailRow label="Founded" value={meta.founded as string} />
        </div>
      );

    case 'Event':
      return (
        <div>
          <DetailRow
            label="Date"
            value={
              meta.startAt
                ? new Date(meta.startAt as string).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : undefined
            }
          />
          <DetailRow label="Location" value={node.location} />
          <DetailRow label="Organizer" value={meta.organizerEmail as string} />
          <DetailRow label="Capacity" value={meta.capacity ? `${meta.capacity} attendees` : undefined} />
        </div>
      );

    default:
      return null;
  }
}
