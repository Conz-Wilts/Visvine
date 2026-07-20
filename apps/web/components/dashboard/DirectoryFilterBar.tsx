'use client';

import { FilterDropdown, SortDropdown } from '@/components/dashboard/FilterDropdown';
import { getNodeTypeConfig } from '@/lib/types';
import type { useDirectoryBrowse } from '@/hooks/useDirectoryBrowse';

interface DirectoryFilterBarProps {
  browse: ReturnType<typeof useDirectoryBrowse>;
}

/**
 * The Type / Tag / Sort filter row for the Directory grid. All state lives in
 * the passed-in useDirectoryBrowse() instance.
 */
export default function DirectoryFilterBar({ browse }: DirectoryFilterBarProps) {
  const {
    nodes, community,
    filterTypes, setFilterTypes,
    filterAliases, setFilterAliases,
    filterTags, setFilterTags,
    sortOrder, setSortOrder,
    presentTypes, presentTags,
  } = browse;

  const showClear =
    filterTypes.size > 0 || filterAliases.size > 0 || filterTags.size > 0 || sortOrder !== 'az';

  return (
    <div className="flex items-center justify-center gap-3 px-6 pt-4 pb-1">
      <FilterDropdown
        label="Type"
        options={presentTypes.map(t => {
          const aliases = (community?.communityAliases ?? []).filter(
            a => a.nodeType.toLowerCase() === t.toLowerCase()
          );
          return {
            value: t,
            label: t,
            count: nodes.filter(n => n.type.toLowerCase() === t.toLowerCase()).length,
            subOptions: aliases.length > 0 ? aliases.map(a => ({
              value: a.name,
              label: a.name,
              color: a.color,
              count: nodes.filter(n => n.type.toLowerCase() === t.toLowerCase() && n.alias === a.name).length,
            })) : undefined,
          };
        })}
        selected={filterTypes}
        onChange={next => { setFilterTypes(next); if (next.size === 0) setFilterAliases(new Set()); }}
        selectedSub={filterAliases}
        onChangeSub={setFilterAliases}
        getColor={t => getNodeTypeConfig(t, community?.nodeTypes).color}
      />
      <FilterDropdown
        label="Tag"
        options={presentTags.map(t => ({
          value: t,
          label: t,
          count: nodes.filter(n => (n.tags ?? []).includes(t)).length,
        }))}
        selected={filterTags}
        onChange={setFilterTags}
      />
      <SortDropdown value={sortOrder} onChange={setSortOrder} />

      {showClear && (
        <button
          onClick={() => {
            setFilterTypes(new Set());
            setFilterAliases(new Set());
            setFilterTags(new Set());
            setSortOrder('az');
          }}
          className="flex h-12 lg:h-10 items-center gap-1.5 rounded-2xl px-4 text-sm lg:text-[13px] font-semibold text-text-muted hover:text-text-secondary hover:bg-surface-3 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Clear filters
        </button>
      )}
    </div>
  );
}
