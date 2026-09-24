'use client';

// The Directory grid's toolbar: search and filters on one left-aligned line,
// with the active filters restated underneath as chips.
//
// The shape is the one every data grid converges on — search first, filter
// controls beside it — because a filter control is
// only useful next to the thing it filters, and a filtered grid has to say so.
// The chip row is the "say so": it names what is being filtered and lets one
// value go without reopening a menu. It exists only while a tag is on, so the
// resting state stays a single line. An alias gets no chip: it is picked in the
// type menu, whose button already names it.
//
// The type is the same TypeMenu the Table view's bar carries; the rest of that
// bar (table/TableToolbar.tsx) is slimmer, because the header sorts there.
// The grid is always A→Z.
//
// All state lives in the passed-in useDirectoryBrowse() instance.

import TypeMenu, { menuTypes } from '@/features/directory/components/TypeMenu';
import TagMenu from '@/features/directory/components/TagMenu';
import { Chip, SearchInput } from '@visvine/ui';
import { tagPalette } from '@/lib/tagColors';
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
    presentTypes, presentTags,
  } = browse;

  const aliases = (space?.aliases ?? []) as SpaceAlias[];
  const tagColors = space?.designConfig?.tagColors ?? null;

  // The same menu the Table's bar carries. The grid is every type at once
  // until one is picked, so All is the resting choice rather than the first
  // type; a single type is the only other state.
  const types = menuTypes(presentTypes, nodes, [], aliases);
  const picked = filterTypes.size === 1 ? [...filterTypes][0].toLowerCase() : null;
  const activeType = picked && types.some(t => t.id === picked) ? picked : 'all';
  const activeAlias = filterAliases.size === 1 ? [...filterAliases][0] : null;

  const activeCount = filterTags.size;

  const without = (set: Set<string>, value: string) => {
    const next = new Set(set);
    next.delete(value);
    return next;
  };


  return (
    // Sticky at 0: the tab set lives in the shell band now, so the only pane
    // chrome above is the 24px painted strip — the toolbar pins flush under
    // it, and the two meet with no seam, neither drawing one. `-ml-6`
    // bleeds into <main>'s gutter so the opaque white runs edge to edge. That
    // background is load-bearing (cards scroll under it), and nothing here may
    // get overflow-hidden or the filter menus clip.
    //
    // pt-1 / pb-2 is the vertical rhythm, not a guess: the row rides close under
    // the shell band, and the 8px below plus the grid's pt-7 puts it 36px above
    // the first card — the filter line reads as its own band between the nav and
    // the content instead of hanging off the nav. The split is lopsided because
    // the gap below is shared: the card's hover glow reaches ~24px past its top
    // edge, so the toolbar's opaque edge has to stay clear of it.
    <div className="sticky top-0 z-10 -ml-6 bg-glass pt-1 pb-2 pl-12 pr-6">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search the directory…"
          size="lg"
          className="w-full max-w-[420px] flex-1 sm:min-w-[280px]"
        />

        <div className="hidden h-6 w-px shrink-0 bg-line-subtle sm:block" />

        <TypeMenu
          types={types}
          activeKey={activeType}
          activeAlias={activeAlias}
          nodeTypes={space?.nodeTypes}
          onChange={(id, alias) => {
            setFilterTypes(id === 'all' ? new Set() : new Set([types.find(t => t.id === id)?.name ?? id]));
            setFilterAliases(alias ? new Set([alias]) : new Set());
          }}
        />

        <TagMenu
          tags={presentTags.map(t => ({
            name: t,
            count: nodes.filter(n => (n.tags ?? []).includes(t)).length,
          }))}
          selected={filterTags}
          total={nodes.length}
          onChange={setFilterTags}
          getColor={t => tagPalette(t, tagColors).base}
        />
      </div>

      {activeCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
            onClick={() => setFilterTags(new Set())}
            className="ml-1 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg-secondary"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
