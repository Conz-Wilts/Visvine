'use client';

// The Table view's control bar, one quiet line: search, which table you are in
// (TypeMenu, the `typeMenu` slot), then the tags on as removable pills. An
// alias is picked in the type menu, whose button already names it, so it gets
// no pill. Search rides the same line, sized to the control beside it — the Table
// names what it is showing and narrows it from one bar, so a full-width search
// band above would be a second bar doing the same job.
//
// The bar holds no menus. Ordering the rows and choosing the columns are the
// HEADER's job — a column's own menu sorts and hides it, "Columns" at the head's
// end chooses them — so restating either here would be a second control for
// one state. The tag pills stay because a tag set on the Grid tab must be
// legible and removable from the table it narrows.
//
// All filter state lives in the passed-in useDirectoryBrowse() instance.

import { type ReactNode } from 'react';
import { SearchInput, Chip } from '@visvine/ui';
import { tagPalette } from '@/lib/tagColors';
import type { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';

interface TableToolbarProps {
  browse: ReturnType<typeof useDirectoryBrowse>;
  /** The table's own name — the type dropdown, beside the search box. */
  typeMenu?: ReactNode;
  /** Named for the type on show — "Search founders…". */
  searchPlaceholder: string;
}

export default function TableToolbar({ browse, typeMenu, searchPlaceholder }: TableToolbarProps) {
  const {
    space,
    searchTerm, setSearchTerm,
    filterTags, setFilterTags,
  } = browse;

  const tagColors = space?.designConfig?.tagColors ?? null;
  const tagColor = (tag: string) => tagPalette(tag, tagColors).base;

  const without = (set: Set<string>, value: string) => {
    const next = new Set(set);
    next.delete(value);
    return next;
  };

  const activeCount = filterTags.size;

  return (
    <div className="flex flex-wrap items-center gap-3 pb-4 pt-1">
      {/* Search leads the bar, then the table's name; nothing is parked at the
          far end. The active filters trail them as removable chips. */}
      <SearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder={searchPlaceholder}
        size="md"
        // The width the context tree's box comes out at: its 360px column less
        // the tree's padding. Same height, same width, so the two read as one
        // control appearing in two places rather than two controls.
        className="w-[344px] shrink-0"
      />

      {typeMenu}

      {[...filterTags].map((tag) => (
        <Chip key={`tag-${tag}`} color={tagColor(tag)} onRemove={() => setFilterTags(without(filterTags, tag))} removeLabel={`Remove ${tag} filter`}>
          {tag}
        </Chip>
      ))}
      {activeCount > 1 && (
        <button
          type="button"
          onClick={() => setFilterTags(new Set())}
          className="text-[12px] font-medium text-fg-muted transition-colors hover:text-fg-secondary"
        >
          Clear
        </button>
      )}
    </div>
  );
}
