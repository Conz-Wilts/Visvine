'use client';

import React from 'react';
import { GraphData } from '@/lib/types';
import { getTypeColor } from '@/components/dashboard/typeStyles';

interface GraphDataTablesProps {
  graphData: GraphData;
  error: string | null;
}

const GraphDataTables: React.FC<GraphDataTablesProps> = ({ graphData, error }) => (
  <div className="space-y-6">
    {error && (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        Error: {error}
      </div>
    )}

    <NodesTable graphData={graphData} />
    <LinksTable graphData={graphData} />
  </div>
);

interface TableProps {
  graphData: GraphData;
}

const NodesTable: React.FC<TableProps> = ({ graphData }) => (
  <div>
    <h3 className="text-lg font-semibold mb-3">Nodes ({graphData.nodes.length})</h3>
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Subtitle</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tags</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {graphData.nodes.map(node => (
            <tr key={node.id}>
              <td className="px-4 py-2 text-sm text-gray-900 font-mono">{node.id}</td>
              <td className="px-4 py-2 text-sm">
                <span
                  className="inline-block w-3 h-3 rounded-full mr-2"
                  style={{ backgroundColor: getTypeColor(node.type) }}
                />
                {node.type}
              </td>
              <td className="px-4 py-2 text-sm text-gray-900">{node.name}</td>
              <td className="px-4 py-2 text-sm text-gray-600">{node.subtitle || '-'}</td>
              <td className="px-4 py-2 text-sm text-gray-600">{node.location || '-'}</td>
              <td className="px-4 py-2 text-sm text-gray-600">
                {node.tags && node.tags.length > 0 ? node.tags.join(', ') : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const LinksTable: React.FC<TableProps> = ({ graphData }) => (
  <div>
    <h3 className="text-lg font-semibold mb-3">Edges ({graphData.links.length})</h3>
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Relationship</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Since</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Metadata</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {graphData.links.map((link, index) => (
            <tr key={index}>
              <td className="px-4 py-2 text-sm text-gray-900 font-mono">{String(link.source)}</td>
              <td className="px-4 py-2 text-sm text-gray-900 font-mono">{String(link.target)}</td>
              <td className="px-4 py-2 text-sm text-gray-900">{link.relationship}</td>
              <td className="px-4 py-2 text-sm text-gray-600">{link.since || '-'}</td>
              <td className="px-4 py-2 text-sm text-gray-600">
                {link.metadata && Object.keys(link.metadata).length > 0
                  ? JSON.stringify(link.metadata)
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default GraphDataTables;
