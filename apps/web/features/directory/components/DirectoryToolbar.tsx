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

import { useEffect, useRef, useState } from 'react';
import PaneTopScrollbarMask from '@/features/shared/components/pane/PaneTopScrollbarMask';
import { FilterDropdown, SortDropdown } from '@/features/directory/components/FilterDropdown';
import Chip from '@/components/ui/Chip';
import SearchInput from '@/components/ui/SearchInput';
import { tagPalette } from '@/lib/tagColors';
import { getNodeTypeConfig } from '@/lib/types';
import type { CommunityAlias } from '@/lib/types';
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
    nodes, community,
    searchTerm, setSearchTerm,
    filterTypes, setFilterTypes,
    filterAliases, setFilterAliases,
    filterTags, setFilterTags,
    sortOrder, setSortOrder,
    presentTypes, presentTags,
  } = browse;

  // The separator only earns its keep once cards are passing under the bar —
  // at rest the toolbar and the grid are one surface, so a line there is just
  // a rule drawn through nothing.
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  // No opaque gutter mask here, deliberately: the scroll track is inset to
  // start just under the tab bar (see PaneTabBar's --scrollbar-track-inset)
  // and the thumb stays visible in front of this bar. But the bar's scrolled
  // border stops at <main>'s content edge — the gutter is outside it — so a
  // transparent strip carries the 1px seam across the gutter up to the
  // scrollbar's lane, and a positioned gradient on the track itself (see
  // globals.css, --scrollbar-track-seam) finishes it across the lane UNDER
  // the thumb. Bottom is measured because the chip row changes the height.
  const [barBottom, setBarBottom] = useState(0);
  useEffect(() => {
    const el = ref.current;
    const scroller = el?.closest('main');
    if (!el || !scroller) return;
    const update = () => {
      const isScrolled = scroller.scrollTop > 0;
      setScrolled(isScrolled);
      const bottom = el.getBoundingClientRect().bottom;
      setBarBottom(bottom);
      if (isScrolled) {
        // Offset of the seam within the track box: the track starts at
        // <main>'s top plus its margin-top inset.
        const inset = parseFloat(getComputedStyle(scroller).getPropertyValue('--scrollbar-track-inset')) || 0;
        const off = Math.round(bottom - 1 - (scroller.getBoundingClientRect().top + inset));
        scroller.style.setProperty(
          '--scrollbar-track-seam',
          `linear-gradient(to bottom, transparent ${off}px, var(--color-border-subtle) ${off}px, var(--color-border-subtle) ${off + 1}px, transparent ${off + 1}px)`,
        );
      } else {
        scroller.style.removeProperty('--scrollbar-track-seam');
      }
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    return () => {
      scroller.removeEventListener('scroll', update);
      resize.disconnect();
      scroller.style.removeProperty('--scrollbar-track-seam');
    };
  }, []);

  const aliases = (community?.communityAliases ?? []) as CommunityAlias[];
  const tagColors = community?.designConfig?.tagColors ?? null;

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
    // row, so it comes to rest with its bottom exactly there — the two bars meet
    // with no seam. `-ml-6` bleeds into <main>'s gutter so the scrolled border
    // continues the tab bar's seam edge to edge. Opaque background is
    // load-bearing (cards scroll under it), and nothing here may get
    // overflow-hidden or the filter menus clip.
    <div
      ref={ref}
      className={`sticky top-8 z-10 -ml-6 bg-surface-1 py-3 pl-12 pr-6 transition-colors ${
        scrolled ? 'border-b border-border-subtle' : 'border-b border-transparent'
      }`}
    >
      {/* Seam-only continuation of the scrolled border across the gutter —
          transparent, so the thumb shows through it. */}
      {scrolled && barBottom > 0 && (
        <PaneTopScrollbarMask bottom={barBottom} border transparent />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search…"
          className="w-full max-w-[320px] !py-2"
        />

        <div className="hidden h-6 w-px shrink-0 bg-border-subtle sm:block" />

        <FilterDropdown
          compact
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
          getColor={t => getNodeTypeConfig(t, community?.nodeTypes).color}
        />

        <FilterDropdown
          compact
          label="Tag"
          options={presentTags.map(t => ({
            value: t,
            label: t,
            count: nodes.filter(n => (n.tags ?? []).includes(t)).length,
          }))}
          selected={filterTags}
          onChange={setFilterTags}
        />

        <div className="ml-auto">
          <SortDropdown compact value={sortOrder} onChange={setSortOrder} />
        </div>
      </div>

      {activeCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {[...filterTypes].map(type => (
            <FilterChip
              key={`type-${type}`}
              label={type}
              color={getNodeTypeConfig(type, community?.nodeTypes).color}
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
