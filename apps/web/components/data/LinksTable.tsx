'use client';

import React, { useState, useEffect } from 'react';
import EditableDataTable, { ColumnConfig } from './EditableDataTable';
import type { RelationshipType } from '@/lib/types';

const RELATIONSHIP_TYPES: RelationshipType[] = [
  'works_at',
  'founded',
  'invested_in',
  'attended',
  'member_of',
  'sponsors',
  'partner_with',
];

interface LinksTableProps {
  communityId: string;
}

// Extended link type for table display
interface LinkRow {
  source: string;
  target: string;
  relationship: string;
  since?: string;
  community_id?: string;
  metadata?: Record<string, unknown>;
}

export default function LinksTable({ communityId }: LinksTableProps) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customColumns, setCustomColumns] = useState<ColumnConfig[]>([]);

  const columns: ColumnConfig[] = [
    {
      key: 'source',
      label: 'Source ID',
      type: 'text',
      required: true,
      placeholder: 'e.g., person:john-doe',
      width: 200,
    },
    {
      key: 'target',
      label: 'Target ID',
      type: 'text',
      required: true,
      placeholder: 'e.g., startup:acme',
      width: 200,
    },
    {
      key: 'relationship',
      label: 'Relationship',
      type: 'select',
      options: RELATIONSHIP_TYPES,
      required: true,
      width: 160,
    },
    {
      key: 'since',
      label: 'Since',
      type: 'date',
      placeholder: 'YYYY-MM-DD',
      width: 140,
    },
    {
      key: 'community_id',
      label: 'Community ID',
      type: 'readonly',
      width: 140,
      filterable: false,
    },
  ];

  const fetchLinks = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/data/links?community_id=${communityId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch links');
      }

      setLinks(data.links);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch links');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
    // Load custom columns from localStorage
    const storedColumns = localStorage.getItem(`links_custom_columns_${communityId}`);
    if (storedColumns) {
      try {
        setCustomColumns(JSON.parse(storedColumns));
      } catch (err) {
        console.error('Error loading custom columns:', err);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);

  const handleAddColumn = (column: ColumnConfig) => {
    const updated = [...customColumns, column];
    setCustomColumns(updated);
    localStorage.setItem(`links_custom_columns_${communityId}`, JSON.stringify(updated));
  };

  const handleRemoveColumn = (columnKey: string) => {
    const updated = customColumns.filter((c) => c.key !== columnKey);
    setCustomColumns(updated);
    localStorage.setItem(`links_custom_columns_${communityId}`, JSON.stringify(updated));
  };

  const handleAdd = async (link: Partial<LinkRow>) => {
    // Process custom columns into metadata
    const processedLink = { ...link };
    processedLink.metadata = processedLink.metadata || {};

    customColumns.forEach((col) => {
      const metadataKey = col.key.split('.')[1];
      const linkRecord = link as Record<string, unknown>;
      if (linkRecord[col.key] !== undefined) {
        processedLink.metadata![metadataKey] = linkRecord[col.key];
      }
    });

    const response = await fetch('/api/data/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: processedLink, community_id: communityId }),
    });

    const data = await response.json();

    if (response.status === 202 && data.queued) {
      throw new Error('⏳ Your link has been submitted for admin review and will appear once approved.');
    }

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create link');
    }

    // Refetch to get the updated list
    await fetchLinks();
  };

  const handleUpdate = async (link: LinkRow, originalLink: LinkRow) => {
    // Process custom columns into metadata
    const processedLink = { ...link };
    processedLink.metadata = processedLink.metadata || {};

    customColumns.forEach((col) => {
      const metadataKey = col.key.split('.')[1];
      const linkRecord = link as unknown as Record<string, unknown>;
      if (linkRecord[col.key] !== undefined) {
        processedLink.metadata![metadataKey] = linkRecord[col.key];
      }
    });

    const response = await fetch('/api/data/links', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        link: processedLink,
        community_id: communityId,
        originalSource: originalLink.source,
        originalTarget: originalLink.target,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update link');
    }
  };

  const handleDelete = async (link: LinkRow) => {
    const response = await fetch(
      `/api/data/links?source_id=${encodeURIComponent(link.source)}&target_id=${encodeURIComponent(link.target)}&community_id=${communityId}`,
      {
        method: 'DELETE',
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete link');
    }
  };

  const createEmptyRow = (): Partial<LinkRow> => ({
    source: '',
    target: '',
    relationship: 'works_at',
    since: '',
    community_id: communityId,
  });

  const validateRow = (link: Partial<LinkRow>): string | null => {
    if (!link.source) return 'Source ID is required';
    if (!link.target) return 'Target ID is required';
    if (!link.relationship) return 'Relationship is required';

    // Validate that source and target are different
    if (link.source === link.target) {
      return 'Source and target must be different';
    }

    // Validate ID format
    const sourceIdParts = link.source.split(':');
    const targetIdParts = link.target.split(':');

    if (sourceIdParts.length !== 2) {
      return 'Source ID must be in format "type:slug" (e.g., person:john-doe)';
    }

    if (targetIdParts.length !== 2) {
      return 'Target ID must be in format "type:slug" (e.g., startup:acme)';
    }

    // Validate date format if provided
    if (link.since && link.since.trim()) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(link.since)) {
        return 'Since date must be in format YYYY-MM-DD';
      }

      // Try to parse the date
      const date = new Date(link.since);
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
    }

    return null;
  };

  const getRowKey = (link: LinkRow): string => {
    return `${link.source}|${link.target}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-600">Loading links...</div>
      </div>
    );
  }

  if (error && links.length === 0) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md">
        <p className="text-red-700">{error}</p>
        <button
          onClick={fetchLinks}
          className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <EditableDataTable
      columns={columns}
      data={links as unknown as Record<string, unknown>[]}
      onAdd={handleAdd as unknown as (row: Partial<Record<string, unknown>>) => Promise<void>}
      onUpdate={handleUpdate as unknown as (row: Record<string, unknown>, originalRow: Record<string, unknown>) => Promise<void>}
      onDelete={handleDelete as unknown as (row: Record<string, unknown>) => Promise<void>}
      getRowKey={getRowKey as unknown as (row: Record<string, unknown>) => string}
      createEmptyRow={createEmptyRow}
      validateRow={validateRow}
      customColumns={customColumns}
      onAddColumn={handleAddColumn}
      onRemoveColumn={handleRemoveColumn}
      tableId={`links_${communityId}`}
    />
  );
}

