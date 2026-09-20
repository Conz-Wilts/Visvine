'use client';

import React from 'react';
import { EarthIcon, LinkedinIcon, MailIcon, PencilIcon, PhoneIcon, TwitterIcon } from '@/features/shared/icons';
import Modal from '@/components/ui/Modal';
import type { FullProfile } from '@/lib/types/profile';

/**
 * A link as a person reads it: no scheme, no `www.`, no trailing slash, but the
 * path kept — a social profile is its path, so a bare hostname says nothing.
 */
const shortUrl = (url: string) =>
  url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

/**
 * The contact channels, read-only, behind the hero's "Contact info" link —
 * the profile keeps its own surface clean and hands the details over only when
 * someone asks for them. The owner gets a way through to the edit dialog.
 */
export default function ContactInfoModal({ open, onClose, profile, isOwner, onEdit }: {
  open: boolean;
  onClose: () => void;
  profile: FullProfile;
  isOwner?: boolean;
  onEdit?: () => void;
}) {
  const rows: { icon: React.ReactNode; label: string; text: string; href: string; external?: boolean }[] = [];
  if (profile.email) rows.push({ icon: <MailIcon className="w-4 h-4" />, label: 'Email', text: profile.email, href: `mailto:${profile.email}` });
  if (profile.phone) rows.push({ icon: <PhoneIcon className="w-4 h-4" />, label: 'Phone', text: profile.phone, href: `tel:${profile.phone}` });
  if (profile.website) rows.push({ icon: <EarthIcon className="w-4 h-4" />, label: 'Website', text: shortUrl(profile.website), href: profile.website, external: true });
  if (profile.linkedinUrl) rows.push({ icon: <LinkedinIcon className="w-4 h-4" />, label: 'LinkedIn', text: shortUrl(profile.linkedinUrl), href: profile.linkedinUrl, external: true });
  if (profile.twitterUrl) rows.push({ icon: <TwitterIcon className="w-4 h-4" />, label: 'X / Twitter', text: shortUrl(profile.twitterUrl), href: profile.twitterUrl, external: true });

  return (
    <Modal title="Contact info" open={open} onClose={onClose} size="sm">
      <div className="p-6">
        {rows.length > 0 ? (
          <div className="flex flex-col gap-4">
            {rows.map((row) => (
              <div key={row.label} className="flex items-start gap-3">
                <span className="mt-0.5 text-text-muted flex-none">{row.icon}</span>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-text-primary">{row.label}</div>
                  <a href={row.href}
                     {...(row.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                     className="text-sm text-text-secondary hover:underline break-words">
                    {row.text}
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            No contact info
          </p>
        )}

        {isOwner && onEdit && (
          <button type="button" onClick={onEdit}
                  className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-muted hover:text-text-primary transition-colors">
            <PencilIcon className="w-3.5 h-3.5" />
            {rows.length > 0 ? 'Edit' : 'Add'}
          </button>
        )}
      </div>
    </Modal>
  );
}
