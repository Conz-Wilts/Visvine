'use client';

// Console → Members. Everything about who is here and what they can do.
//
// One tab answers "who can see what?", because the answer used to be split three
// ways: aliases and their grants lived under the Person node type on Types, the
// per-tool lock lived among the sidebar layout controls on Tools, and Members
// could only show you people it couldn't change. Now Types describes things,
// Tools arranges the sidebar, and permissions are all here.

import { useState } from 'react';
import { Alert } from '@/components/ui';
import type { Community } from '@/lib/types';
import AliasesTab from './AliasesTab';
import MembersTab from './MembersTab';
import RequestsTab from './RequestsTab';
import ToolAccessTab from './ToolAccessTab';
import { usePeopleSection } from './PeopleDataContext';

type Tab = 'people' | 'aliases' | 'tools' | 'requests';

export default function MembersPanel({ community, onSaved }: {
  community: Community;
  onSaved: (updated: Partial<Community>) => void;
}) {
  const { data, error, setError } = usePeopleSection();
  const [tab, setTab] = useState<Tab>('people');

  // Both queues a person can be waiting in, counted the way the console tab
  // above counts them — one definition of "waiting", in PeopleDataContext.
  const waiting =
    (data?.members ?? []).filter((m) => m.status === 'pending').length +
    (data?.requests ?? []).filter((r) => r.status === 'pending').length;

  const tabs: [Tab, string][] = [
    ['people', `People${data ? ` (${data.members.filter((m) => m.status !== 'pending').length})` : ''}`],
    ['aliases', 'Aliases'],
    ['tools', 'Tools'],
    ['requests', waiting > 0 ? `Requests (${waiting})` : 'Requests'],
  ];

  return (
    <div className="space-y-5">
      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}

      <div className="flex gap-1 border-b border-border-subtle">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 pb-2 text-sm font-medium transition-colors ${
              tab === id
                ? 'border-brand-green text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tool access is the one tab that reads the community record rather than
          the People snapshot, so it takes the same props the Tools section does. */}
      {data === null && tab !== 'tools' ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : tab === 'people' ? (
        <MembersTab />
      ) : tab === 'aliases' ? (
        <AliasesTab />
      ) : tab === 'tools' ? (
        <ToolAccessTab community={community} onSaved={onSaved} />
      ) : (
        <RequestsTab />
      )}
    </div>
  );
}
