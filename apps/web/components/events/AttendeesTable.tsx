'use client';

/**
 * Attendees table with sorting, filtering, and actions
 */

import { useState, useMemo } from 'react';
import type { NBAttendee, RSVPStatus } from '@/lib/types';
import { CheckCircle, Clock, XCircle, UserCheck } from 'lucide-react';

interface AttendeeWithPerson extends NBAttendee {
  person?: {
    id: string;
    name: string;
    subtitle?: string;
    tags?: string[];
  } | null;
}

interface AttendeesTableProps {
  attendees: AttendeeWithPerson[];
}

const STATUS_CONFIG: Record<RSVPStatus, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  going: { label: 'Going', icon: CheckCircle, color: 'text-brand-green' },
  registered: { label: 'Going', icon: CheckCircle, color: 'text-brand-green' },
  pending: { label: 'Pending', icon: Clock, color: 'text-amber-500' },
  waitlisted: { label: 'Waitlisted', icon: Clock, color: 'text-orange-500' },
  invited: { label: 'Invited', icon: Clock, color: 'text-blue-500' },
  cancelled: { label: 'Cancelled', icon: XCircle, color: 'text-brand-grey' },
  checked_in: { label: 'Checked In', icon: UserCheck, color: 'text-brand-green' },
  no_show: { label: 'No Show', icon: XCircle, color: 'text-brand-grey' },
};

export function AttendeesTable({ attendees }: AttendeesTableProps) {
  const [filterStatus, setFilterStatus] = useState<RSVPStatus | 'all'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'status'>('date');

  const filteredAndSorted = useMemo(() => {
    let result = [...attendees];

    // Filter by status
    if (filterStatus !== 'all') {
      result = result.filter((a) => a.status === filterStatus);
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'name') {
        const nameA = a.person?.name || '';
        const nameB = b.person?.name || '';
        return nameA.localeCompare(nameB);
      } else if (sortBy === 'date') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      } else {
        return a.status.localeCompare(b.status);
      }
    });

    return result;
  }, [attendees, filterStatus, sortBy]);

  const statusCounts = useMemo(() => {
    return attendees.reduce((acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    }, {} as Record<RSVPStatus, number>);
  }, [attendees]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2.5">
          <label className="text-sm font-medium text-brand-black">
            Filter:
          </label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as RSVPStatus | 'all')}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg bg-brand-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green transition-all"
          >
            <option value="all">All ({attendees.length})</option>
            {Object.entries(statusCounts).map(([status, count]) => (
              <option key={status} value={status}>
                {STATUS_CONFIG[status as RSVPStatus].label} ({count})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2.5">
          <label className="text-sm font-medium text-brand-black">
            Sort by:
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'date' | 'status')}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg bg-brand-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green transition-all"
          >
            <option value="date">Registration Date</option>
            <option value="name">Name</option>
            <option value="status">Status</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-brand-light-bg border-b border-brand-green">
            <tr>
              <th className="px-5 py-4 text-left font-semibold text-brand-black">
                Name
              </th>
              <th className="px-5 py-4 text-left font-semibold text-brand-black">
                Email
              </th>
              <th className="px-5 py-4 text-left font-semibold text-brand-black">
                Company
              </th>
              <th className="px-5 py-4 text-left font-semibold text-brand-black">
                Status
              </th>
              <th className="px-5 py-4 text-left font-semibold text-brand-black">
                Registered
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-brand-white">
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-brand-grey">
                  No attendees found
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((attendee) => {
                const StatusIcon = STATUS_CONFIG[attendee.status].icon;
                return (
                  <tr
                    key={attendee.id}
                    className="hover:bg-brand-light-bg transition-colors"
                  >
                    <td className="px-5 py-4">
                      <div className="font-semibold text-brand-black">
                        {attendee.person?.name || 'Unknown'}
                      </div>
                      {attendee.roleTitle && (
                        <div className="text-xs text-brand-grey mt-0.5">
                          {attendee.roleTitle}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-brand-grey">
                      {attendee.email || '—'}
                    </td>
                    <td className="px-5 py-4 text-brand-grey">
                      {attendee.companyName || '—'}
                    </td>
                    <td className="px-5 py-4">
                      <div className={`flex items-center gap-2 font-medium ${STATUS_CONFIG[attendee.status].color}`}>
                        <StatusIcon className="w-4 h-4" />
                        <span>{STATUS_CONFIG[attendee.status].label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-brand-grey">
                      {new Date(attendee.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

