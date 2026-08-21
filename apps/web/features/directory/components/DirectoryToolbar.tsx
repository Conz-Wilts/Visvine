'use client';

// The Directory grid's toolbar: search, filters, sort and the result count on
// one left-aligned line, with the active filters restated underneath as chips.
//
// The shape is the one every data grid converges on — search first, filter
// controls beside it, sort and count pushed right — because a filter control is
// only useful next to the thing it filters, and a filtered grid has to say so.
// The chip row is the "say so": it names what is being filtered and lets one
// value go without reopening a menu. It exists only while something is active,
// so the resting state stays a single line.
//
// All state lives in the passed-in useDirectoryBrowse() instance.

import { FilterDropdown, SortToggle } from '@/features/directory/components/FilterDropdown';
import Chip from '@/components/ui/Chip';
import SearchInput from '@/components/ui/SearchInput';
import { tagPalette } from '@/lib/tagColors';
import { getNodeTypeConfig } from '@/lib/types';
import type { SpaceAlias } from '@/lib/types';
import type { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';

interface DirectoryToolbarProps {
  browse: ReturnType<typeof useDirectoryBrowse>;
}

/** One active filter, coloured by the thing it filters on. */
function FilterChip({ label, color, onRemove }: {
  label: string;
  color: string;
  onRemove: () => void;
}) {
  return (
    <Chip color={color} onRemove={onRemove} removeLabel={`Remove ${label} filter`}>
      {label}
    </Chip>
  );
}

export default function DirectoryToolbar({ browse }: DirectoryToolbarProps) {
  const {
    nodes, space,
    searchTerm, setSearchTerm,
    filterTypes, setFilterTypes,
    filterAliases, setFilterAliases,
    filterTags, setFilterTags,
    sortOrder, setSortOrder,
    presentTypes, presentTags,
  } = browse;

  const aliases = (space?.aliases ?? []) as SpaceAlias[];
  const tagColors = space?.designConfig?.tagColors ?? null;

  const activeCount = filterTypes.size + filterAliases.size + filterTags.size;

  const without = (set: Set<string>, value: string) => {
    const next = new Set(set);
    next.delete(value);
    return next;
  };

  const clearAll = () => {
    setFilterTypes(new Set());
    setFilterAliases(new Set());
    setFilterTags(new Set());
    setSortOrder('az');
  };

  return (
    // Sticky at 32px: the pane tab bar above is `sticky -top-4` around a 48px
    // row, so it comes to rest with its bottom exactly there — the two bars
    // meet with no seam, and neither draws one. `-ml-6` bleeds into <main>'s
    // gutter so the opaque white runs edge to edge. That background is
    // load-bearing (cards scroll under it), and nothing here may get
    // overflow-hidden or the filter menus clip.
    <div className="sticky top-8 z-10 -ml-6 bg-surface-1 py-3 pl-12 pr-6">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search the directory…"
          size="lg"
          className="w-full max-w-[420px] flex-1 sm:min-w-[280px]"
        />

        <div className="hidden h-6 w-px shrink-0 bg-border-subtle sm:block" />

        <FilterDropdown
          label="Type"
          options={presentTypes.map(t => {
            const forType = aliases.filter(a => a.nodeType.toLowerCase() === t.toLowerCase());
            return {
              value: t,
              label: t,
              count: nodes.filter(n => n.type.toLowerCase() === t.toLowerCase()).length,
              subOptions: forType.length > 0 ? forType.map(a => ({
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
          getColor={t => getNodeTypeConfig(t, space?.nodeTypes).color}
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
          getColor={t => tagPalette(t, tagColors).base}
        />

        <div className="ml-auto">
          <SortToggle value={sortOrder} onChange={setSortOrder} />
        </div>
      </div>

      {activeCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {[...filterTypes].map(type => (
            <FilterChip
              key={`type-${type}`}
              label={type}
              color={getNodeTypeConfig(type, space?.nodeTypes).color}
              onRemove={() => setFilterTypes(without(filterTypes, type))}
            />
          ))}
          {[...filterAliases].map(alias => (
            <FilterChip
              key={`alias-${alias}`}
              label={alias}
              color={aliases.find(a => a.name === alias)?.color ?? 'var(--color-brand-green)'}
              onRemove={() => setFilterAliases(without(filterAliases, alias))}
            />
          ))}
          {[...filterTags].map(tag => (
            <FilterChip
              key={`tag-${tag}`}
              label={tag}
              color={tagPalette(tag, tagColors).base}
              onRemove={() => setFilterTags(without(filterTags, tag))}
            />
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-[13px] font-medium text-text-muted transition-colors hover:text-text-secondary"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
