'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import MembersPanel from '@/components/admin/MembersPanel';
import SubmissionsPanel from '@/components/admin/SubmissionsPanel';
import CommunitySettingsPanel from '@/components/admin/CommunitySettingsPanel';
import ActivityLogPanel from '@/components/admin/ActivityLogPanel';
import NodesTable from '@/components/data/NodesTable';
import LinksTable from '@/components/data/LinksTable';
import TypesTab from '@/components/data/TypesTab';
import AnalyticsPanel from '@/components/analytics/AnalyticsPanel';
import CommunityDesignPanel from '@/components/admin/CommunityDesignPanel';
import { PageHeader, LoadingText, TabNav, Alert } from '@/components/ui';
import { useState } from 'react';
import { Community } from '@/lib/types';

type Tab = 'general' | 'design' | 'members' | 'submissions' | 'activity' | 'nodes' | 'links' | 'types' | 'analytics';

export default function AdminPage() {
  const { currentCommunity, isAdmin, loading, refreshCommunity } = useCommunity();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [localCommunity, setLocalCommunity] = useState<Community | null>(null);

  useEffect(() => {
    if (currentCommunity) setLocalCommunity(currentCommunity);
  }, [currentCommunity]);

  // Redirect non-admins away once we know their status
  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace('/directory');
    }
  }, [loading, isAdmin, router]);

  if (loading) {
    return (
      <div className="w-full px-6 py-8">
        <LoadingText text="Loading…" />
      </div>
    );
  }

  if (!currentCommunity || !isAdmin) {
    return (
      <div className="w-full px-6 py-8">
        <Alert variant="info">Select a community you administer to access this page.</Alert>
      </div>
    );
  }

  const community = localCommunity ?? currentCommunity;

  return (
    <div className="w-full">
      <div className="w-full px-6 py-8">
        <PageHeader
          title="Community Console"
          titleClassName="text-4xl font-normal tracking-tight font-ginto"
          description={
            <>Manage <span className="font-medium">{community.name}</span></>
          }
        />

        <TabNav
          className="mb-6"
          tabs={[
            { id: 'general', label: 'General' },
            { id: 'design', label: 'Design' },
            { id: 'members', label: 'Members' },
            { id: 'submissions', label: 'Submissions' },
            { id: 'activity', label: 'Activity Log' },
            { id: 'nodes', label: 'Nodes' },
            { id: 'links', label: 'Links' },
            { id: 'types', label: 'Types' },
            { id: 'analytics', label: 'Analytics' },
          ]}
          activeTab={activeTab}
          onTabChange={id => setActiveTab(id as Tab)}
        />

        <div className="bg-surface-1">
          {activeTab === 'members' && (
            <MembersPanel communityId={community.id} />
          )}
          {activeTab === 'submissions' && (
            <SubmissionsPanel communityId={community.id} />
          )}
          {activeTab === 'activity' && (
            <ActivityLogPanel communityId={community.id} />
          )}
          {activeTab === 'general' && (
            <CommunitySettingsPanel
              community={community}
              onSaved={updated => {
                setLocalCommunity(prev => prev ? { ...prev, ...updated } : prev);
                refreshCommunity();
              }}
            />
          )}
          {activeTab === 'design' && (
            <CommunityDesignPanel
              community={community}
              onSaved={updated => {
                setLocalCommunity(prev => prev ? { ...prev, ...updated } : prev);
                refreshCommunity();
              }}
            />
          )}
          {activeTab === 'nodes' && <NodesTable communityId={community.id} />}
          {activeTab === 'links' && <LinksTable communityId={community.id} />}
          {activeTab === 'types' && (
            <TypesTab
              key={`${community.id}-${JSON.stringify(community.nodeTypes)}`}
              communityId={community.id}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsPanel communityId={community.id} />
          )}
        </div>
      </div>
    </div>
  );
}
