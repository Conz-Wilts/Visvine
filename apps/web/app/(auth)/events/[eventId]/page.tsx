'use client';

/**
 * Event detail page with tabs
 */

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { EventHeader } from '@/components/events/EventHeader';
import { EventActions } from '@/components/events/EventActions';
import { AttendeesTable } from '@/components/events/AttendeesTable';
import { DeleteEventModal } from '@/components/events/DeleteEventModal';
import { copyToClipboard } from '@/lib/utils';
import type { NBEvent, NBAttendee } from '@/lib/types';
import { Link2, Trash2 } from 'lucide-react';

interface AttendeeWithPerson extends NBAttendee {
  person?: {
    id: string;
    name: string;
    subtitle?: string;
    tags?: string[];
  } | null;
}

type Tab = 'overview' | 'attendees' | 'form';

interface EventStats {
  total: number;
  registered: number;
  waitlisted: number;
  invited: number;
  checkedIn: number;
  cancelled: number;
  noShow: number;
}

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { currentCommunity } = useCommunity();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [event, setEvent] = useState<NBEvent | null>(null);
  const [attendees, setAttendees] = useState<AttendeeWithPerson[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    if (!currentCommunity) return;

    const loadEvent = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/events/${resolvedParams.eventId}?communityId=${currentCommunity.id}`
        );
        const data = await response.json();
        setEvent(data.event);
        setStats(data.stats);
      } catch (error) {
        console.error('Failed to load event:', error);
      } finally {
        setLoading(false);
      }
    };

    loadEvent();
  }, [currentCommunity, resolvedParams.eventId]);

  useEffect(() => {
    if (!currentCommunity || activeTab !== 'attendees') return;

    const loadAttendees = async () => {
      try {
        const response = await fetch(
          `/api/events/${resolvedParams.eventId}/attendees?communityId=${currentCommunity.id}`
        );
        const data = await response.json();
        setAttendees(data.attendees);
      } catch (error) {
        console.error('Failed to load attendees:', error);
      }
    };

    loadAttendees();
  }, [currentCommunity, resolvedParams.eventId, activeTab]);

  const handleCopyFormLink = async () => {
    const url = `${window.location.origin}/events/${resolvedParams.eventId}/rsvp`;
    const success = await copyToClipboard(url);
    setCopyStatus(success ? 'Copied!' : 'Failed');
    setTimeout(() => setCopyStatus(''), 2000);
  };

  const handleDeleteSuccess = () => {
    router.push('/events');
  };

  if (!currentCommunity) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="text-center text-brand-grey">
          Please select a community to view this event.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="text-center text-brand-grey">Loading event...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="text-center text-brand-grey">Event not found</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <EventHeader
              event={event}
              attendeeCount={stats?.registered || 0}
              showCapacity={true}
            />
          </div>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="p-2.5 text-brand-green hover:bg-brand-green/10 rounded-lg transition-all border border-gray-200 hover:border-brand-green"
            title="Delete event"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>

        <EventActions
          event={event}
          communityId={currentCommunity.id}
          showGraphLink={true}
        />

        <div className="border-b border-gray-200">
          <nav className="flex gap-6">
            {(['overview', 'attendees', 'form'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-1 py-3 text-sm font-semibold border-b-2 transition-all ${activeTab === tab
                    ? 'border-brand-green text-brand-green'
                    : 'border-transparent text-brand-grey hover:text-brand-black hover:border-gray-200'
                  }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'attendees' && stats && ` (${stats.total})`}
              </button>
            ))}
          </nav>
        </div>

        <div className="min-h-[400px]">
          {activeTab === 'overview' && (
            <div className="space-y-8">
              {event.description && (
                <div>
                  <h3 className="text-xl font-bold text-brand-black mb-3">
                    About
                  </h3>
                  <p className="text-brand-grey whitespace-pre-wrap leading-relaxed">
                    {event.description}
                  </p>
                </div>
              )}

              {stats && (
                <div>
                  <h3 className="text-xl font-bold text-brand-black mb-5">
                    Stats
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-5 bg-brand-light-bg rounded-xl border border-brand-light-bg">
                      <div className="text-3xl font-bold text-brand-green">
                        {stats.registered}
                      </div>
                      <div className="text-sm text-brand-grey mt-1">
                        Registered
                      </div>
                    </div>
                    <div className="p-5 bg-brand-light-bg rounded-xl border border-brand-light-bg">
                      <div className="text-3xl font-bold text-brand-green">
                        {stats.waitlisted}
                      </div>
                      <div className="text-sm text-brand-grey mt-1">
                        Waitlisted
                      </div>
                    </div>
                    <div className="p-5 bg-brand-light-bg rounded-xl border border-brand-light-bg">
                      <div className="text-3xl font-bold text-brand-green">
                        {stats.checkedIn}
                      </div>
                      <div className="text-sm text-brand-grey mt-1">
                        Checked In
                      </div>
                    </div>
                    <div className="p-5 bg-brand-light-bg rounded-xl border border-brand-light-bg">
                      <div className="text-3xl font-bold text-brand-green">
                        {stats.total}
                      </div>
                      <div className="text-sm text-brand-grey mt-1">
                        Total
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'attendees' && (
            <AttendeesTable attendees={attendees} />
          )}

          {activeTab === 'form' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-brand-black">
                  RSVP Form
                </h3>
                <button
                  onClick={handleCopyFormLink}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-brand-black bg-brand-white border border-gray-200 rounded-lg hover:border-brand-green hover:bg-brand-light-bg transition-all"
                >
                  <Link2 className="w-4 h-4" />
                  {copyStatus || 'Copy Form Link'}
                </button>
              </div>

              <div className="p-6 bg-brand-light-bg rounded-xl border border-brand-green space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-brand-black">
                    Form Status
                  </span>
                  <span
                    className={`px-3 py-1.5 text-xs font-semibold rounded-full ${event.form.enabled
                        ? 'bg-brand-light-bg text-brand-green'
                        : 'bg-gray-100 text-brand-grey'
                      }`}
                  >
                    {event.form.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                {event.form.requireApproval && (
                  <p className="text-sm text-brand-grey">
                    Requires approval: RSVPs will be pending until approved
                  </p>
                )}

                {event.form.domainAllowlist && event.form.domainAllowlist.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-brand-black mb-2">
                      Allowed Email Domains:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {event.form.domainAllowlist.map((domain) => (
                        <span
                          key={domain}
                          className="px-3 py-1.5 text-xs font-semibold rounded-full bg-brand-green text-brand-green"
                        >
                          {domain}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-sm font-semibold text-brand-black mb-2">
                    Public RSVP URL:
                  </p>
                  <Link
                    href={`/events/${resolvedParams.eventId}/rsvp`}
                    className="text-sm text-brand-green hover:underline break-all"
                  >
                    {window.location.origin}/events/{resolvedParams.eventId}/rsvp
                  </Link>
                </div>

                {event.form.schema.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-brand-black mb-2">
                      Form Fields ({event.form.schema.length}):
                    </p>
                    <ul className="list-disc list-inside text-sm text-brand-grey space-y-1">
                      {event.form.schema.map((field) => (
                        <li key={field.id}>
                          {field.label} ({field.type})
                          {field.required && <span className="text-brand-green"> *</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Modal */}
      {showDeleteModal && (
        <DeleteEventModal
          eventTitle={event.title}
          eventId={event.id}
          communityId={currentCommunity.id}
          onClose={() => setShowDeleteModal(false)}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  );
}

