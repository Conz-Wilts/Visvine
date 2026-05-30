'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Maximize2, MapPin, ExternalLink, Linkedin, Twitter,
  Phone, Mail, Globe2,
  Wrench, Users, Building2, Calendar, ChevronDown, ChevronUp,
} from 'lucide-react';
import { NBNode } from '@/lib/types';
import { getPalette, hexToPalette, type ThemePalette } from '@/lib/profileTheme';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useProfileCache } from '@/lib/contexts/ProfileContext';
import { getNodeTypeConfig } from '@/lib/types';
import { useProfile } from '@/hooks/useProfile';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import EventSidebarContent from './EventSidebarContent';
import { getInitials } from '@/lib/avatarUtils';

/** Stable dedupe-by-id (the /api/nodes/[id] payload can repeat a connection). */
function dedupeById<T extends { id: string }>(items: T[] | undefined | null): T[] {
  if (!items) return [];
  const seen = new Set<string>();
  return items.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

interface NodeDetailsSidebarProps {
  node: NBNode | null;
  onClose: () => void;
  onExpandToFullPage?: (node: NBNode) => void;
}

function memberSinceYear(iso: string | undefined) {
  if (!iso) return null;
  return new Date(iso).getFullYear();
}

// ── Theme hook ────────────────────────────────────────────────────────────────

function usePersonTheme(nodeId: string | null, fallbackColor: string): ThemePalette {
  const { getCached, version } = useProfileCache();
  void version;
  const cached = nodeId?.startsWith('person:') ? getCached(nodeId) : null;
  const themeId = cached?.metadata?.themeColor as string | undefined;
  return themeId ? getPalette(themeId) : hexToPalette(fallbackColor);
}

// ── Small shared primitives ───────────────────────────────────────────────────

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-1 rounded-2xl border border-border-subtle overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-2.5">
      <span className="text-text-muted">{icon}</span>
      <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">{title}</h3>
    </div>
  );
}

function BioText({ bio }: { bio: string }) {
  const [expanded, setExpanded] = useState(false);
  const threshold = 200;
  const long = bio.length > threshold;
  const displayed = long && !expanded ? bio.slice(0, threshold).trimEnd() + '…' : bio;
  return (
    <div>
      <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{displayed}</p>
      {long && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1.5 flex items-center gap-0.5 text-xs font-medium text-brand-dark-green hover:underline"
        >
          {expanded
            ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</>
            : <><ChevronDown className="w-3.5 h-3.5" /> Read more</>}
        </button>
      )}
    </div>
  );
}

// ── Non-person sidebar (org / event / etc.) ───────────────────────────────────

function NonPersonContent({
  displayNode,
  theme,
}: {
  displayNode: NBNode;
  theme: ThemePalette;
}) {
  // Connections are fetched on demand per-node (cached + deduped) rather than
  // sliced from the full community link set — so the grid/table views never
  // need to load links just to populate this sidebar.
  const { data: nodeData } = useNodeProfile(displayNode.id);
  const connectedNodes = useMemo(() => dedupeById(nodeData?.connections), [nodeData?.connections]);

  const bio = displayNode.metadata?.bio as string | undefined;
  const displayTags = (displayNode.tags ?? []).filter(
    tag => !['Building in Public', 'Open to Work', 'Hiring', 'Available', 'Busy'].some(s =>
      tag.toLowerCase().includes(s.toLowerCase())
    )
  );

  return (
    <div className="p-3 flex flex-col gap-3">
      {bio && (
        <SectionCard>
          <SectionHeader icon={<Globe2 className="w-3.5 h-3.5" />} title="About" />
          <div className="px-4 pb-4">
            <BioText bio={bio} />
          </div>
        </SectionCard>
      )}

      {displayTags.length > 0 && (
        <SectionCard>
          <SectionHeader icon={<Wrench className="w-3.5 h-3.5" />} title="Skills &amp; Interests" />
          <div className="px-4 pb-4 flex flex-wrap gap-1.5">
            {displayTags.map((tag, i) => (
              <span
                key={i}
                className="px-2.5 py-1 text-xs font-medium rounded-full border"
                style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}
              >
                {tag}
              </span>
            ))}
          </div>
        </SectionCard>
      )}

      {connectedNodes.length > 0 && (
        <SectionCard>
          <SectionHeader icon={<Users className="w-3.5 h-3.5" />} title={`Connections · ${connectedNodes.length}`} />
          <div className="px-4 pb-4 grid grid-cols-3 gap-2">
            {connectedNodes.slice(0, 9).map(n => (
              <div
                key={n.id}
                className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-border-subtle bg-surface-2"
              >
                {n.image_url ? (
                  <img src={n.image_url} alt={n.name} className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold"
                    style={{ background: theme.light, color: theme.dark }}
                  >
                    {getInitials(n.name)}
                  </div>
                )}
                <span className="text-[10px] text-text-secondary text-center leading-tight line-clamp-2">{n.name}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ── Person profile content ────────────────────────────────────────────────────

function PersonProfileContent({
  nodeId,
  theme,
}: {
  nodeId: string;
  theme: ThemePalette;
}) {
  const { profile, loading } = useProfile(nodeId);
  const { data: nodeData } = useNodeProfile(nodeId);

  const connectionCount = nodeData?.connectionCount ?? 0;
  const communityCount = nodeData?.communityCount ?? 1;
  const connections = useMemo(() => dedupeById(nodeData?.connections), [nodeData?.connections]);
  const hasContact = !!(profile?.email || profile?.phone || profile?.website || profile?.linkedinUrl || profile?.twitterUrl);

  // Show skeleton only for body sections, not the whole panel
  const showProfileSkeleton = loading && !profile;

  if (showProfileSkeleton && !nodeData) {
    return (
      <div className="p-4 flex flex-col gap-3 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-surface-1 rounded-2xl h-24 border border-border-subtle" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-3">

      {/* Stat chips */}
      <div className="flex flex-wrap gap-2">
        <span
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
          style={{ background: theme.light, color: theme.dark }}
        >
          <Users className="w-3.5 h-3.5" style={{ color: theme.base }} />
          <span className="font-bold">{connectionCount}</span>
          <span className="text-xs opacity-70">connections</span>
        </span>
        <span
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
          style={{ background: theme.light, color: theme.dark }}
        >
          <Building2 className="w-3.5 h-3.5" style={{ color: theme.base }} />
          <span className="font-bold">{communityCount}</span>
          <span className="text-xs opacity-70">communities</span>
        </span>
        {profile?.createdAt && (
          <span
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
            style={{ background: theme.light, color: theme.dark }}
          >
            <Calendar className="w-3.5 h-3.5" style={{ color: theme.base }} />
            <span className="font-bold">{memberSinceYear(profile.createdAt)}</span>
            <span className="text-xs opacity-70">member since</span>
          </span>
        )}
      </div>

      {/* CTAs */}
      <div className="flex gap-2">
        <button
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white rounded-full transition-all hover:opacity-90 active:scale-95"
          style={{ background: theme.base }}
        >
          <Users className="w-4 h-4" /> Connect
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-full border-2 transition-all hover:bg-surface-2 active:scale-95"
          style={{ color: theme.dark, borderColor: theme.base }}
        >
          <Mail className="w-4 h-4" /> Message
        </button>
      </div>

      {/* Profile sections — show skeleton rows while profile fetch completes */}
      {showProfileSkeleton && (
        <div className="flex flex-col gap-3 animate-pulse">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-surface-1 rounded-2xl h-20 border border-border-subtle" />
          ))}
        </div>
      )}

      {/* About */}
      {profile?.bio && (
        <SectionCard>
          <SectionHeader icon={<Globe2 className="w-3.5 h-3.5" />} title="About" />
          <div className="px-4 pb-4">
            <BioText bio={profile.bio} />
          </div>
        </SectionCard>
      )}

      {/* Skills */}
      {profile && profile.tags.length > 0 && (
        <SectionCard>
          <SectionHeader icon={<Wrench className="w-3.5 h-3.5" />} title="Skills" />
          <div className="px-4 pb-4 flex flex-wrap gap-1.5">
            {profile.tags.map((tag, i) => (
              <span
                key={i}
                className="px-2.5 py-1 text-xs font-medium rounded-full border"
                style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}
              >
                {tag}
              </span>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Connections strip */}
      {connections.length > 0 && (
        <SectionCard>
          <SectionHeader icon={<Users className="w-3.5 h-3.5" />} title={`Connections (${connectionCount})`} />
          <div className="px-4 pb-4 overflow-x-auto">
            <div className="flex gap-3">
              {connections.slice(0, 10).map(conn => (
                <div key={conn.id} className="group flex-shrink-0 flex flex-col items-center gap-1 cursor-pointer" title={conn.name}>
                  <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-border-subtle group-hover:ring-brand-green transition-all group-hover:scale-110">
                    {conn.image_url ? (
                      <img src={conn.image_url} alt={conn.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-surface-3 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-text-muted">{getInitials(conn.name)}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted truncate max-w-[40px] leading-tight">{conn.name.split(' ')[0]}</span>
                </div>
              ))}
              {connectionCount > 10 && (
                <div className="flex-shrink-0 flex flex-col items-center gap-1">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold border-2" style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}>
                    +{connectionCount - 10}
                  </div>
                  <span className="text-[10px] text-text-muted">more</span>
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      )}

      {/* Contact */}
      {profile && hasContact && (
        <SectionCard>
          <SectionHeader icon={<Mail className="w-3.5 h-3.5" />} title="Contact" />
          <div className="px-4 pb-4 space-y-2.5">
            {profile.email && (
              <a href={`mailto:${profile.email}`} className="flex items-center gap-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
                <Mail className="w-4 h-4 text-text-muted flex-shrink-0" /> {profile.email}
              </a>
            )}
            {profile.phone && (
              <a href={`tel:${profile.phone}`} className="flex items-center gap-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
                <Phone className="w-4 h-4 text-text-muted flex-shrink-0" /> {profile.phone}
              </a>
            )}
            {profile.website && (
              <a href={profile.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-sm hover:underline transition-colors" style={{ color: theme.dark }}>
                <ExternalLink className="w-4 h-4 flex-shrink-0" />
                {(() => { try { return new URL(profile.website).hostname.replace('www.', ''); } catch { return profile.website ?? ''; } })()}
              </a>
            )}
            {profile.linkedinUrl && (
              <a href={profile.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
                <Linkedin className="w-4 h-4 text-text-muted flex-shrink-0" /> LinkedIn
              </a>
            )}
            {profile.twitterUrl && (
              <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors">
                <Twitter className="w-4 h-4 text-text-muted flex-shrink-0" /> X / Twitter
              </a>
            )}
          </div>
        </SectionCard>
      )}

    </div>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

const NodeDetailsSidebar: React.FC<NodeDetailsSidebarProps> = ({
  node,
  onClose,
  onExpandToFullPage,
}) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const isOpen = node !== null;
  const [displayNode, setDisplayNode] = useState<NBNode | null>(node);
  const [isContentVisible, setIsContentVisible] = useState(true);

  useEffect(() => {
    if (node?.id === displayNode?.id) return;
    if (node === null) {
      setDisplayNode(null);
      setIsContentVisible(true);
    } else if (displayNode === null) {
      setDisplayNode(node);
      setIsContentVisible(true);
    } else {
      setIsContentVisible(false);
      const timeout = setTimeout(() => {
        setDisplayNode(node);
        setIsContentVisible(true);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [node, displayNode]);

  useEffect(() => {
    if (isOpen) setTimeout(() => closeBtnRef.current?.focus(), 50);
  }, [isOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) onClose();
    };
    const timeoutId = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 100);
    return () => { clearTimeout(timeoutId); document.removeEventListener('mousedown', handleClickOutside); };
  }, [isOpen, onClose]);

  const { currentCommunity } = useCommunity();
  const nodeTypeColor = getNodeTypeConfig(displayNode?.type ?? 'People', currentCommunity?.nodeTypes).color;
  const theme = usePersonTheme(displayNode?.id ?? null, nodeTypeColor);

  // Overlay cache on basic display fields
  const { getCached, version } = useProfileCache();
  void version;
  const cached = displayNode?.id?.startsWith('person:') ? getCached(displayNode.id) : null;
  const displayName     = cached?.name     ?? displayNode?.name     ?? '';
  const displaySubtitle = cached?.subtitle ?? displayNode?.subtitle;
  const displayLocation = cached?.location ?? displayNode?.location;
  const displayImageUrl = cached?.imageUrl ?? displayNode?.image_url;
  const isPerson = !!displayNode?.id?.startsWith('person:');

  function handleExpandToFullPage() {
    if (displayNode && onExpandToFullPage) onExpandToFullPage(displayNode);
  }

  return (
    <aside
      ref={sidebarRef}
      role="dialog"
      aria-label={displayNode ? `Profile: ${displayName}` : 'Profile'}
      aria-modal="true"
      className={`fixed top-24 right-4 h-[calc(100vh-7rem)] bg-surface-2 shadow-2xl z-40 transition-all duration-300 ease-in-out overflow-hidden rounded-3xl
        ${isOpen ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]'}
        w-full sm:w-[520px]`}
    >
      {displayNode && (
        <div className={`h-full flex flex-col transition-opacity duration-200 ${isContentVisible ? 'opacity-100' : 'opacity-0'}`}>

          {/* ── Top bar ───────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-5 py-3 bg-surface-1 border-b border-border-subtle flex-shrink-0 rounded-t-3xl">
            <button
              onClick={handleExpandToFullPage}
              className="flex items-center gap-1.5 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors"
              aria-label="Expand to full profile"
              title="Open full profile"
            >
              <Maximize2 className="w-4 h-4" />
              Full Profile
            </button>
            <button
              ref={closeBtnRef}
              onClick={onClose}
              className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-xl transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ── Scrollable body ──────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto">

            {/* Hero: avatar + identity */}
            <div className="bg-surface-1 border-b border-border-subtle px-5 py-5">
              <div className="flex items-start gap-5">
                {/* Square avatar */}
                <div
                  className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0"
                  style={{ boxShadow: isPerson ? `0 0 0 3px ${theme.base}55, 0 4px 16px ${theme.base}33` : undefined }}
                >
                  {displayImageUrl ? (
                    <img src={displayImageUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-xl font-bold text-white"
                      style={isPerson
                        ? { background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }
                        : { background: 'linear-gradient(135deg, #6b7280, #374151)' }
                      }
                    >
                      {getInitials(displayName)}
                    </div>
                  )}
                </div>

                {/* Identity */}
                <div className="flex-1 min-w-0">
                  {/* Type badge + alias */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border"
                      style={{ background: `${theme.base}20`, color: theme.dark, borderColor: `${theme.base}40` }}
                    >
                      {displayNode?.type ?? 'Node'}
                    </span>
                    {displayNode?.alias && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-3 text-text-muted border border-border-subtle">
                        {displayNode.alias}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-bold text-text-primary leading-tight">{displayName}</h2>
                  {displaySubtitle ? (
                    <p className="text-sm text-text-secondary leading-snug mt-1">{displaySubtitle}</p>
                  ) : isPerson ? (
                    <p className="text-sm text-text-muted italic mt-1">No role listed</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {displayLocation && (
                      <span className="flex items-center gap-1 text-sm text-text-muted">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" /> {displayLocation}
                      </span>
                    )}
                    {(cached as { website?: string } | null)?.website && (
                      <a
                        href={(cached as { website?: string }).website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm hover:underline"
                        style={{ color: theme.dark }}
                      >
                        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                        {(() => { try { return new URL((cached as { website: string }).website).hostname.replace('www.', ''); } catch { return ''; } })()}
                      </a>
                    )}
                  </div>
                  {/* Open to work badge */}
                  {(cached as { openToWork?: boolean } | null)?.openToWork && (
                    <div className="mt-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border" style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}60` }}>
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: theme.base }} />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: theme.base }} />
                        </span>
                        Open to work
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Body content */}
            {isPerson
              ? <PersonProfileContent nodeId={displayNode.id} theme={theme} />
              : (displayNode.id.startsWith('event:') || displayNode.type?.toLowerCase() === 'event')
                ? <EventSidebarContent displayNode={displayNode} theme={theme} />
                : <NonPersonContent displayNode={displayNode} theme={theme} />
            }
          </div>
        </div>
      )}
    </aside>
  );
};

export default NodeDetailsSidebar;
