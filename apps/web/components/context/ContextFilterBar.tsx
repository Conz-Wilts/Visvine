'use client';

// The Context explorer's toolbar. Deliberately the Directory grid's toolbar,
// down to the control sizes and the chip row: search first, the Type and Tag
// menus beside it, one control pushed right, active filters restated
// underneath as removable chips. Same job, so the same bar, minus the grid's
// Sort control — a tree is already sorted, by the hierarchy.
//
// The filters don't rip notes out of the hierarchy: the tree below prunes to
// the survivors and their folder chains.

import { X } from 'lucide-react';
import { FilterDropdown } from '@/components/dashboard/FilterDropdown';
import SearchInput from '@/components/ui/SearchInput';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { tagPalette } from '@/lib/tagColors';
import { findNodeTypeConfig, getNodeTypeConfig } from '@/lib/types';
import type { useContextBrowse } from '@/hooks/useContextBrowse';

interface ContextFilterBarProps {
  browse: ReturnType<typeof useContextBrowse>;
  /** Community tag → colour registry, so chips match the rest of the app. */
  tagColors?: Record<string, string> | null;
}

function Chip({ label, color, onRemove }: { label: string; color: string; onRemove: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md py-0.5 pl-2 pr-1 text-[11px] font-semibold text-white"
      style={{ background: color }}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export default function ContextFilterBar({ browse, tagColors }: ContextFilterBarProps) {
  const { currentCommunity } = useCommunity();
  const nodeTypes = currentCommunity?.nodeTypes;
  const typeColor = (type: string) => getNodeTypeConfig(type, nodeTypes).color;
  // Notes carry free-text frontmatter types; the menu names them the way the
  // community console does whenever the value resolves to a real type.
  const typeName = (type: string) => findNodeTypeConfig(type, nodeTypes)?.name ?? type;
  const {
    items,
    searchTerm, setSearchTerm,
    filterTags, setFilterTags,
    filterTypes, setFilterTypes,
    starredOnly, setStarredOnly,
    connectedTo, setConnectedTo,
    presentTags, presentTypes,
    activeCount, clearFilters,
  } = browse;

  const without = (set: Set<string>, value: string) => {
    const next = new Set(set);
    next.delete(value);
    return next;
  };

  const connectedTitle = connectedTo
    ? (items.find((i) => i.path === connectedTo)?.title ?? connectedTo)
    : null;

  return (
    <div className="border-b border-border-subtle bg-surface-1 px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search…"
          className="w-full max-w-[320px] !py-2"
        />

        <div className="hidden h-6 w-px shrink-0 bg-border-subtle sm:block" />

        {presentTypes.length > 0 && (
          <FilterDropdown
            compact
            label="Type"
            options={presentTypes.map(([type, count]) => ({ value: type, label: typeName(type), count }))}
            selected={filterTypes}
            onChange={setFilterTypes}
            getColor={typeColor}
          />
        )}

        <FilterDropdown
          compact
          label="Tag"
          options={presentTags.map(([tag, count]) => ({ value: tag, label: tag, count }))}
          selected={filterTags}
          onChange={setFilterTags}
          getColor={(tag) => tagPalette(tag, tagColors).base}
        />

      </div>

      {activeCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {connectedTitle && (
            <Chip
              label={`Connected to ${connectedTitle}`}
              color="var(--color-brand-dark-green)"
              onRemove={() => setConnectedTo(null)}
            />
          )}
          {[...filterTypes].map((type) => (
            <Chip
              key={`type-${type}`}
              label={typeName(type)}
              color={typeColor(type)}
              onRemove={() => setFilterTypes(without(filterTypes, type))}
            />
          ))}
          {[...filterTags].map((tag) => (
            <Chip
              key={`tag-${tag}`}
              label={tag}
              color={tagPalette(tag, tagColors).base}
              onRemove={() => setFilterTags(without(filterTags, tag))}
            />
          ))}
          {starredOnly && (
            <Chip label="Starred" color="var(--color-brand-gold)" onRemove={() => setStarredOnly(false)} />
          )}
          <button
            type="button"
            onClick={clearFilters}
            className="ml-1 text-[13px] font-medium text-text-muted transition-colors hover:text-text-secondary"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
