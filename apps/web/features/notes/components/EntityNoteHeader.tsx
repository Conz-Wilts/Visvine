'use client'

// Header for an entity *context note* — a note that records context about a
// directory person/company (frontmatter carries the `node:` id; the path lives
// under people/ or companies/). Instead of the plain big title, these notes open
// with a compact identity card (square avatar + name + one-line description) and
// an expand toggle that smoothly reveals the real directory profile *inline* —
// the same components the /directory/[nodeId] page renders, so it stays in sync.

import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { getAvatarColor, getInitials } from '@/lib/avatarUtils'
import { useNodeProfile } from '@/hooks/useNodeProfile'
import ProfileSkeletonLoader from '@/components/profile/ProfileSkeletonLoader'
import ProfileHero from '@/components/profile/ProfileHero'
import ProfileTabBar, { type ProfileTab } from '@/components/profile/ProfileTabBar'
import ProfileAboutPanel from '@/components/profile/ProfileAboutPanel'
import ConnectionsGrid from '@/components/profile/ConnectionsGrid'
import CommunitiesPanel from '@/components/profile/CommunitiesPanel'
import ActivityFeed from '@/components/profile/ActivityFeed'
import ProfilePageContent from '@/components/profile/ProfilePageContent'

interface EntityNoteHeaderProps {
  /** Directory node id from the note frontmatter (e.g. `person:craig`). */
  nodeId: string
  name: string
  subtitle?: string | null
  imageUrl?: string | null
  /** Keep a private copy of this entity note in the user's personal brain. */
  onAddToPersonal?: () => void
}

export function EntityNoteHeader({ nodeId, name, subtitle, imageUrl, onAddToPersonal }: EntityNoteHeaderProps) {
  const [open, setOpen] = useState(false)
  // Mount the (data-fetching) profile embed only once the user first expands it,
  // then keep it mounted so re-opening is instant and doesn't re-fetch.
  const [everOpened, setEverOpened] = useState(false)

  const toggle = () => {
    setOpen((v) => !v)
    setEverOpened(true)
  }

  return (
    <div className="mb-6">
      {/* Identity card — the clean, collapsed view: square image + name + headline. */}
      <div className="flex items-center gap-5 rounded-2xl border border-border-subtle bg-surface-1 px-5 py-4 shadow-soft">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={name}
            className="h-20 w-20 flex-none rounded-2xl object-cover ring-1 ring-border-subtle"
          />
        ) : (
          <div
            className={`flex h-20 w-20 flex-none items-center justify-center rounded-2xl text-2xl font-semibold text-white ${getAvatarColor(name)}`}
          >
            {getInitials(name)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[2.5rem] font-semibold leading-[1.1] tracking-tight text-text-primary">{name}</h1>
          {subtitle ? <p className="mt-1 truncate text-base text-text-secondary">{subtitle}</p> : null}
        </div>

        <div className="flex flex-none items-center gap-1.5">
          {onAddToPersonal ? (
            <button
              type="button"
              onClick={onAddToPersonal}
              title="Keep a private copy in your personal brain"
              className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
            >
              Add to my notes
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
          >
            {open ? 'Hide profile' : 'View profile'}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
          </button>
          <Link
            href={`/directory/${encodeURIComponent(nodeId)}`}
            aria-label="Open full profile"
            title="Open full profile"
            className="inline-flex items-center justify-center rounded-full border border-border-subtle bg-surface-1 p-1.5 text-text-muted transition hover:bg-surface-2 hover:text-text-primary"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Expandable profile — CSS grid-rows 0fr→1fr animates height:auto smoothly. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className={`pt-4 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}>
            {everOpened ? <EntityProfileEmbed nodeId={nodeId} /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// Renders the directory profile inline, mirroring /directory/[nodeId]: person
// nodes get the rich LinkedIn-style profile; other node types get the tab view.
function EntityProfileEmbed({ nodeId }: { nodeId: string }) {
  if (nodeId.startsWith('person:')) {
    return <ProfilePageContent nodeId={nodeId} overlay />
  }
  return <NodeProfileEmbed nodeId={nodeId} />
}

// Inline copy of the directory page's non-person tab view (without the page's
// back button / outer chrome), so a company/org context note can preview its
// profile in place.
function NodeProfileEmbed({ nodeId }: { nodeId: string }) {
  const { data, loading, error } = useNodeProfile(nodeId)
  const [activeTab, setActiveTab] = useState<ProfileTab>('about')

  if (loading) return <ProfileSkeletonLoader mode="fullpage" />
  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <div className="text-4xl">😕</div>
        <p className="text-sm font-semibold text-text-primary">Profile not found</p>
      </div>
    )
  }

  const { node, connectionCount, communityCount, connections } = data
  const communities = node.community_id
    ? [{ id: node.community_id, name: node.community_id, role: 'member' }]
    : []
  const activityItems = connections.slice(0, 10).map((conn, i) => ({
    id: `conn-${i}`,
    type: 'connected' as const,
    description: `Connected with ${conn.name}`,
    timestamp: conn.since || node.createdAt || new Date().toISOString(),
  }))

  return (
    <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-soft">
      <ProfileHero
        node={node}
        mode="fullpage"
        ctaState="idle"
        connectionCount={connectionCount}
        communityCount={communityCount}
        mutualConnections={[]}
        onConnectionsClick={() => setActiveTab('connections')}
        onCommunitiesClick={() => setActiveTab('communities')}
      />
      <div className="px-2">
        <ProfileTabBar
          nodeType={node.type}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          connectionCount={connectionCount}
          communityCount={communityCount}
          activityCount={activityItems.length}
        />
      </div>
      <div role="tabpanel" className="px-6 py-6">
        {activeTab === 'about' && <ProfileAboutPanel node={node} />}
        {activeTab === 'connections' && <ConnectionsGrid connections={connections} nodeType={node.type} />}
        {activeTab === 'communities' && <CommunitiesPanel communities={communities} />}
        {activeTab === 'activity' && <ActivityFeed items={activityItems} />}
      </div>
    </div>
  )
}
