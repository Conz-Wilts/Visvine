'use client';
import { useState, useEffect } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useAdminRole } from '@/hooks/useAdminRole';
import type { ResourceChange } from '@/lib/types';

export default function AdminResourcesPage() {
  const { currentCommunity } = useCommunity();
  const { isAdmin } = useAdminRole(currentCommunity?.id ?? null);
  const [changes, setChanges] = useState<ResourceChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [resourceNames, setResourceNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!currentCommunity || !isAdmin) return;
    loadChanges();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCommunity, isAdmin]);

  async function loadChanges() {
    if (!currentCommunity) return;
    setLoading(true);
    const res = await fetch(`/api/resources?community_id=${currentCommunity.id}`);
    const resources = await res.json();
    const nameMap: Record<string, string> = {};
    for (const r of resources) nameMap[r.id] = r.name;
    setResourceNames(nameMap);

    const allChanges: ResourceChange[] = [];
    for (const r of resources) {
      const cr = await fetch(`/api/resources/${r.id}/changes?status=pending`);
      const cdata = await cr.json();
      allChanges.push(...cdata);
    }
    setChanges(allChanges);
    setLoading(false);
  }

  async function review(changeId: string, status: 'approved' | 'rejected') {
    const change = changes.find(c => c.id === changeId);
    if (!change) return;
    await fetch(`/api/resources/${change.resourceId}/changes/${changeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reviewedBy: 'admin' }),
    });
    setChanges(prev => prev.filter(c => c.id !== changeId));
  }

  if (!currentCommunity) return <div className="p-6 text-gray-500">Select a community.</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Admin — Pending Changes</h1>
      <p className="text-sm text-gray-500 mb-6">Review proposed cell edits before they take effect.</p>

      {!isAdmin ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <p className="text-yellow-800">You are not an admin for this community.</p>
        </div>
      ) : (
        <>
          {loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : changes.length === 0 ? (
            <p className="text-gray-500">No pending changes.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="border border-gray-200 px-3 py-2">Resource</th>
                    <th className="border border-gray-200 px-3 py-2">Cell</th>
                    <th className="border border-gray-200 px-3 py-2">Current</th>
                    <th className="border border-gray-200 px-3 py-2">Proposed</th>
                    <th className="border border-gray-200 px-3 py-2">Reason</th>
                    <th className="border border-gray-200 px-3 py-2">By</th>
                    <th className="border border-gray-200 px-3 py-2">Date</th>
                    <th className="border border-gray-200 px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-3 py-2">{resourceNames[c.resourceId] ?? c.resourceId}</td>
                      <td className="border border-gray-200 px-3 py-2 font-mono">{c.cellRef}</td>
                      <td className="border border-gray-200 px-3 py-2 text-gray-500">{c.originalValue || '(empty)'}</td>
                      <td className="border border-gray-200 px-3 py-2 text-green-700 font-medium">{c.proposedValue}</td>
                      <td className="border border-gray-200 px-3 py-2 text-gray-500">{c.reason || '—'}</td>
                      <td className="border border-gray-200 px-3 py-2">{c.proposedBy}</td>
                      <td className="border border-gray-200 px-3 py-2">{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td className="border border-gray-200 px-3 py-2">
                        <div className="flex gap-2">
                          <button onClick={() => review(c.id, 'approved')} className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600">Approve</button>
                          <button onClick={() => review(c.id, 'rejected')} className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </>
      )}
    </div>
  );
}
