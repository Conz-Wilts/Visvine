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
// The Table view shares the bar with two differences: the type is a tab there,
// so the Type menu gives way to an Alias menu for the current type; and the
// header sorts, so the A→Z toggle gives way to whatever the view puts on the
// right (its Columns menu).
//
// All state lives in the passed-in useDirectoryBrowse() instance.

import type { ReactNode } from 'react';
import { FilterDropdown, SortToggle } from '@/features/directory/components/FilterDropdown';
import Chip from '@/components/ui/Chip';
import SearchInput from '@/components/ui/SearchInput';
import { tagPalette } from '@/lib/tagColors';
import { getNodeTypeConfig } from '@/lib/types';
import type { SpaceAlias } from '@/lib/types';
import type { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';

interface DirectoryToolbarProps {
  browse: ReturnType<typeof useDirectoryBrowse>;
  mode?: 'grid' | 'table';
  /** Table mode: the type whose aliases the Alias menu offers. */
  aliasType?: string;
  /** Table mode: what sits at the right end of the row. */
  trailing?: ReactNode;
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

export default function DirectoryToolbar({ browse, mode = 'grid', aliasType, trailing }: DirectoryToolbarProps) {
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
  const table = mode === 'table';
  const typeAliases = table
    ? aliases.filter(a => a.nodeType.toLowerCase() === (aliasType ?? '').toLowerCase())
    : [];

  // The type filter belongs to the grid; in the table it is the tab.
  const activeCount = (table ? 0 : filterTypes.size) + filterAliases.size + filterTags.size;

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
    //
    // pt-9 / pb-2 is the vertical rhythm, not a guess: the row sits 36px below
    // the tab bar, and the 8px here plus the grid's pt-7 puts it 36px above the
    // first card — the search line reads centred between the nav and the
    // content instead of hanging off the nav. The split is lopsided because the
    // gap below is shared: the card's hover glow reaches ~24px past its top
    // edge, so the toolbar's opaque edge has to stay clear of it.
    <div className="sticky top-8 z-10 -ml-6 bg-glass pt-9 pb-2 pl-12 pr-6">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search the directory…"
          size="lg"
          className="w-full max-w-[420px] flex-1 sm:min-w-[280px]"
        />

        <div className="hidden h-6 w-px shrink-0 bg-border-subtle sm:block" />

        {!table && (
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
        )}

        {table && typeAliases.length > 0 && (
          <FilterDropdown
            label="Alias"
            options={typeAliases.map(a => ({
              value: a.name,
              label: a.name,
              count: nodes.filter(n => n.alias === a.name).length,
            }))}
            selected={filterAliases}
            onChange={setFilterAliases}
            getColor={name => typeAliases.find(a => a.name === name)?.color ?? 'var(--color-brand-green)'}
          />
        )}

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
          {table ? trailing : <SortToggle value={sortOrder} onChange={setSortOrder} />}
        </div>
      </div>

      {activeCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {!table && [...filterTypes].map(type => (
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
