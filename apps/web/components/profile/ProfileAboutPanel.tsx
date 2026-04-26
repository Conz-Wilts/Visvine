'use client';

import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { NBNode } from '@/lib/types';
import NodeTypeDetailsSection from './NodeTypeDetailsSection';

interface ProfileAboutPanelProps {
  node: NBNode;
  isOwner?: boolean;
}

export default function ProfileAboutPanel({ node, isOwner }: ProfileAboutPanelProps) {
  const [bioExpanded, setBioExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);

  const bio = node.metadata?.bio as string | undefined;
  const displayTags = (node.tags ?? []).filter(
    (tag) =>
      !['Building in Public', 'Open to Work', 'Hiring', 'Available', 'Busy'].some((s) =>
        tag.toLowerCase().includes(s.toLowerCase())
      )
  );

  const visibleTags = tagsExpanded ? displayTags : displayTags.slice(0, 8);
  const hasTypeDetails =
    ['People', 'Startup', 'Investor', 'Organization', 'Group', 'Event'].includes(node.type) &&
    Object.keys(node.metadata ?? {}).length > 0;

  return (
    <div className="space-y-6">
      {/* Bio */}
      <section>
        <h3 className="text-sm font-semibold text-brand-black mb-3">About</h3>
        {bio ? (
          <div>
            <p
              className={`text-sm text-brand-black leading-relaxed ${
                !bioExpanded ? 'line-clamp-4 md:line-clamp-none' : ''
              }`}
            >
              {bio}
            </p>
            <button
              onClick={() => setBioExpanded(!bioExpanded)}
              className="md:hidden mt-1 text-xs font-medium text-brand-dark-green hover:underline"
            >
              {bioExpanded ? 'Show less' : 'See more'}
            </button>
          </div>
        ) : isOwner ? (
          <p className="text-sm text-brand-grey italic">
            Tell your network what you&apos;re working on.{' '}
            <button className="font-medium text-brand-dark-green hover:underline">
              + Add bio
            </button>
          </p>
        ) : null}
      </section>

      {/* Skills & Interests */}
      {displayTags.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-brand-black mb-3">Skills &amp; Interests</h3>
          <div className="flex flex-wrap gap-2">
            {visibleTags.map((tag, i) => (
              <span
                key={i}
                className="px-3 py-1 text-xs font-medium text-brand-dark-green bg-brand-light-bg rounded-full"
              >
                {tag}
              </span>
            ))}
            {displayTags.length > 8 && (
              <button
                onClick={() => setTagsExpanded(!tagsExpanded)}
                className="px-3 py-1 text-xs font-medium text-brand-grey bg-gray-50 rounded-full hover:bg-gray-100 transition-colors"
              >
                {tagsExpanded ? 'Show less' : `+${displayTags.length - 8} more`}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Type-specific details */}
      {hasTypeDetails && (
        <section>
          <h3 className="text-sm font-semibold text-brand-black mb-3">Details</h3>
          <NodeTypeDetailsSection node={node} />
        </section>
      )}

      {/* Links */}
      {node.url && (
        <section>
          <h3 className="text-sm font-semibold text-brand-black mb-3">Links</h3>
          <a
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-brand-dark-green hover:underline"
          >
            <ExternalLink className="w-4 h-4 flex-shrink-0" />
            {(() => {
              try {
                return new URL(node.url!).hostname.replace('www.', '');
              } catch {
                return node.url;
              }
            })()}
          </a>
        </section>
      )}
    </div>
  );
}
