'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import MembersPanel from '@/components/admin/MembersPanel';
import SubmissionsPanel from '@/components/admin/SubmissionsPanel';
import CommunitySettingsPanel from '@/components/admin/CommunitySettingsPanel';
import ActivityLogPanel from '@/components/admin/ActivityLogPanel';
import TypesTab from '@/components/data/TypesTab';
import AnalyticsPanel from '@/components/analytics/AnalyticsPanel';
import CommunityDesignPanel from '@/components/admin/CommunityDesignPanel';
import { PageHeader, LoadingText, TabNav, Alert } from '@/components/ui';
import { useState } from 'react';
import { Community } from '@/lib/types';

type Tab = 'general' | 'design' | 'members' | 'submissions' | 'activity' | 'types' | 'analytics';

/** Clean framed surface for the settings-style tabs (forms, member list). */
function Panel({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border border-border-subtle bg-surface-1 shadow-soft ${className}`}>
      {children}
    </div>
  );
}

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
      <div className="w-full max-w-6xl mx-auto px-6 py-8">
        <PageHeader
          title="Community Console"
          titleClassName="text-5xl font-normal tracking-tight font-ginto"
          description={
            <>Manage <span className="font-medium">{community.name}</span></>
          }
        />

        <TabNav
          className="mb-8"
          center
          tabs={[
            { id: 'general', label: 'General' },
            { id: 'design', label: 'Design' },
            { id: 'members', label: 'Members' },
            { id: 'submissions', label: 'Submissions' },
            { id: 'activity', label: 'Activity Log' },
            { id: 'types', label: 'Types' },
            { id: 'analytics', label: 'Analytics' },
          ]}
          activeTab={activeTab}
          onTabChange={id => setActiveTab(id as Tab)}
        />

        {/* Settings-style tabs sit in a single clean card; dashboard-style
            tabs (submissions / activity / analytics) render their own cards
            straight onto the page background. */}
        {activeTab === 'general' && (
          <Panel className="max-w-xl mx-auto p-6 sm:p-8">
            <CommunitySettingsPanel
              community={community}
              onSaved={updated => {
                setLocalCommunity(prev => prev ? { ...prev, ...updated } : prev);
                refreshCommunity();
              }}
            />
          </Panel>
        )}
        {activeTab === 'design' && (
          <Panel className="max-w-2xl mx-auto p-6 sm:p-8">
            <CommunityDesignPanel
              community={community}
              onSaved={updated => {
                setLocalCommunity(prev => prev ? { ...prev, ...updated } : prev);
                refreshCommunity();
              }}
            />
          </Panel>
        )}
        {activeTab === 'members' && (
          <Panel className="p-6">
            <MembersPanel communityId={community.id} />
          </Panel>
        )}
        {activeTab === 'types' && (
          <TypesTab
            key={`${community.id}-${JSON.stringify(community.nodeTypes)}`}
            communityId={community.id}
          />
        )}
        {activeTab === 'submissions' && (
          <SubmissionsPanel communityId={community.id} />
        )}
        {activeTab === 'activity' && (
          <ActivityLogPanel communityId={community.id} />
        )}
        {activeTab === 'analytics' && (
          <AnalyticsPanel communityId={community.id} />
        )}
      </div>
    </div>
  );
}
