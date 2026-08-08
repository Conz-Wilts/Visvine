'use client';

// The explorer's middle column: what the selected note connects to.
//
// One list, grouped by what the other end IS — people, deals, funds, plain
// notes — because that's how you scan a neighbourhood of any size: a founder
// note with forty links is unreadable as forty rows, and readable as "28
// people, 9 deals, 3 funds". Groups collapse; direction rides along on each
// row as an arrow (→ out, ← in, ↔ mutual) rather than splitting the list in
// two and making you read both halves to find one name.
//
// Index notes — the thing a folder actually IS in this product — get their own
// group, pinned to the top, above the notes that live inside them. The label
// comes from the community's own type registry, so it reads "Index" by default
// and follows a rename for free; it is never called a folder here.
//
// Each group is painted in its type's configured colour — the same colour the
// directory grid and the profile rails use — because the grouping IS the
// information, and a column of identical grey rows makes you read it word by
// word. Clicking a row re-selects it in the browser — the tree reveals it and
// the content column swaps — so walking a chain of notes never leaves the page.

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, ArrowLeftRight, ChevronDown, ChevronRight, Unlink } from 'lucide-react';
import { folderOfIndexPath, isIndexPath } from '@/lib/notes/shared/indexNote';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { getNodeTypeConfig } from '@/lib/types';
import { getTypeColor, getOnWhiteTextBg } from '@/components/dashboard/typeStyles';
import type { ContextItem } from '@/hooks/useContextBrowse';

type Direction = 'out' | 'in' | 'both' | 'unresolved';

interface Connection {
  key: string;
  /** null for an unresolved link — nothing on the other end to select. */
  path: string | null;
  title: string;
  direction: Direction;
}

interface Group {
  type: string;
  label: string;
  /** The type's configured colour — what the whole group is painted in. */
  color: string;
  connections: Connection[];
}

// Sort keys, not labels. INDEX pins the index group to the top; the other two
// stand for "this has no type" and "there's nothing on the other end", which
// are absences rather than types and are deliberately left uncoloured.
const INDEX = '__index__';
const UNTYPED = '__note__';
const UNRESOLVED = '__unresolved__';

/**
 * Absences read as grey; anything else is a real type with a real colour. A
 * literal hex rather than the muted token because every colour here is also
 * suffixed with an alpha pair for the hover tint, which a `var()` can't take.
 */
const NEUTRAL = '#6b7280';

const DIRECTION_ICON: Record<Direction, typeof ArrowRight> = {
  out: ArrowRight,
  in: ArrowLeft,
  both: ArrowLeftRight,
  unresolved: Unlink,
};

const DIRECTION_TITLE: Record<Direction, string> = {
  out: 'This note links here',
  in: 'Links to this note',
  both: 'Linked both ways',
  unresolved: 'Nothing on the other end',
};

interface ContextLinksPanelProps {
  /** The selected note, or null for the resting summary. */
  item: ContextItem | null;
  /** Every note in scope — resolves backlinks and the other end's type. */
  items: ContextItem[];
  /** Path → display title, owned by the browser so both panels agree. */
  titleFor: (path: string) => string;
  /**
   * What survives the toolbar's facets — notes plus every folder on the way
   * down to them, the same set the tree prunes by. Null when nothing is
   * filtering. The toolbar spans all three columns, so a connection to a note
   * the filter excluded is hidden here too; without this the column happily
   * listed rows the tree had just pruned away.
   */
  keep: Set<string> | null;
  onSelectPath: (path: string) => void;
}

export default function ContextLinksPanel({
  item, items, titleFor, keep, onSelectPath,
}: ContextLinksPanelProps) {
  const { currentCommunity } = useCommunity();
  const nodeTypes = currentCommunity?.nodeTypes;
  // Collapsed groups only — a type absent from the set is open, so a note that
  // gains a new kind of connection shows it without a click.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Does this link's other end survive the toolbar's facets? The keep set holds
  // folders, not the index notes that stand for them, so an index link is
  // judged by its folder — which is the same thing (lib/notes/shared/indexNote).
  // An unresolved link has neither type nor tags, so no facet can ever include
  // it: while a filter is on, it's noise.
  const survives = useCallback(
    (path: string | null) => {
      if (!keep) return true;
      if (path === null) return false;
      return keep.has(isIndexPath(path) ? folderOfIndexPath(path) : path);
    },
    [keep],
  );

  const groups = useMemo<Group[]>(() => {
    if (!item) return [];
    const byPath = new Map(items.map((i) => [i.path, i]));
    const out = new Set(item.linkTargets);
    const incoming = items
      .filter((other) => other.path !== item.path && other.linkTargets.includes(item.path))
      .map((other) => other.path);

    const connections: Connection[] = [];
    for (const path of out) {
      if (path === item.path || !survives(path)) continue;
      connections.push({
        key: path,
        path,
        title: titleFor(path),
        direction: incoming.includes(path) ? 'both' : 'out',
      });
    }
    for (const path of incoming) {
      if (out.has(path) || !survives(path)) continue;
      connections.push({ key: path, path, title: titleFor(path), direction: 'in' });
    }
    // A link with nothing on the other end. Worth keeping: it's the note saying
    // something exists that the context hasn't captured yet.
    for (const name of item.unresolved) {
      if (!survives(null)) continue;
      connections.push({ key: `unresolved:${name}`, path: null, title: name, direction: 'unresolved' });
    }

    const byType = new Map<string, Connection[]>();
    for (const connection of connections) {
      // Group by the community's own type names (the console is the registry),
      // so `company` and `Community` land in one group under one spelling. Only
      // a note with no type at all falls into the untyped bucket.
      const rawType = connection.path ? byPath.get(connection.path)?.type?.trim() : null;
      const type =
        connection.path === null
          ? UNRESOLVED
          : isIndexPath(connection.path)
            ? INDEX
            : rawType
              ? getNodeTypeConfig(rawType, nodeTypes).name
              : UNTYPED;
      const list = byType.get(type);
      if (list) list.push(connection);
      else byType.set(type, [connection]);
    }

    // The index group's label and colour come from the community's own Index
    // type, so a community that renames or recolours it is obeyed here too.
    const indexConfig = getNodeTypeConfig('Index', nodeTypes);

    return [...byType.entries()]
      .map(([type, list]) => ({
        type,
        label:
          type === INDEX ? indexConfig.name
          : type === UNTYPED ? 'Untyped'
          : type === UNRESOLVED ? 'Unresolved'
          // Anything else IS a community type name, resolved when it was grouped.
          : type,
        color:
          type === INDEX ? indexConfig.color
          : type === UNTYPED || type === UNRESOLVED ? NEUTRAL
          : getTypeColor(type, nodeTypes),
        connections: list.sort((a, b) => a.title.localeCompare(b.title)),
      }))
      // Indexes first (they're the containers everything else sits in), then
      // the biggest group — the note's dominant relationship — with unresolved
      // always last, since it's a to-do list, not a neighbourhood.
      .sort((a, b) => {
        if (a.type === INDEX) return -1;
        if (b.type === INDEX) return 1;
        if (a.type === UNRESOLVED) return 1;
        if (b.type === UNRESOLVED) return -1;
        return b.connections.length - a.connections.length || a.label.localeCompare(b.label);
      });
  }, [item, items, titleFor, nodeTypes, survives]);

  if (!item) {
    return (
      <div className="flex h-full flex-col justify-center gap-2 px-4 text-sm text-text-muted">
        <p className="text-text-secondary">Select a context to see what it connects to.</p>
      </div>
    );
  }

  const total = groups.reduce((sum, group) => sum + group.connections.length, 0);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        Connections
      </h2>

      {total === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          {keep
            ? 'No connections match the current filters.'
            : 'Nothing links here yet, and this note links nowhere.'}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.type);
            const Chevron = isCollapsed ? ChevronRight : ChevronDown;
            return (
              <section key={group.type}>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(group.type)) next.add(group.type);
                      return next;
                    })
                  }
                  // The header IS the colour: a full-width bar in the type's own
                  // colour with white text, so the eye lands on the band before
                  // it reads a word. getOnWhiteTextBg keeps the hue and darkens
                  // only as far as white legibility needs — type colours are
                  // console-configurable and some (Community green) are light.
                  style={{ backgroundColor: getOnWhiteTextBg(group.color) }}
                  // -mx-4 cancels the panel's own padding so the band runs edge
                  // to edge: a colour bar with a gutter either side reads as a
                  // button, a full-bleed one reads as a section divider.
                  className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-1.5 px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white transition-opacity hover:opacity-90"
                >
                  <Chevron className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  <span className="truncate">{group.label}</span>
                  <span className="opacity-75">· {group.connections.length}</span>
                </button>

                {!isCollapsed && (
                  // Rows hang off a faint rail in the same colour, so a list
                  // scrolled past its bar still says which group it belongs to.
                  <ul
                    className="mt-1 ml-2 flex flex-col gap-0.5 border-l-2 pl-1.5"
                    style={{ borderColor: `${group.color}40` }}
                  >
                    {group.connections.map((connection) => {
                      const Icon = DIRECTION_ICON[connection.direction];
                      // Name first, direction last: the arrow is a qualifier on
                      // the row, and leading with it turned the column into a
                      // wall of arrows you had to read past to reach a name.
                      const body = (
                        <>
                          <span className="min-w-0 flex-1 truncate">{connection.title}</span>
                          <Icon
                            className="h-3 w-3 shrink-0 text-text-muted opacity-50 transition-opacity group-hover/row:opacity-100"
                            aria-label={DIRECTION_TITLE[connection.direction]}
                          />
                        </>
                      );
                      return (
                        <li key={connection.key}>
                          {connection.path ? (
                            <button
                              type="button"
                              onClick={() => onSelectPath(connection.path!)}
                              title={DIRECTION_TITLE[connection.direction]}
                              // Hover tints in the group's own colour rather than
                              // the brand green, so the row never claims to be a
                              // type it isn't. Colours are runtime config, so the
                              // tint rides in as a custom property.
                              style={{ '--row-tint': `${group.color}1a` } as CSSProperties}
                              className="group/row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-[var(--row-tint)] hover:text-text-primary"
                            >
                              {body}
                            </button>
                          ) : (
                            <div
                              title={DIRECTION_TITLE.unresolved}
                              className="group/row flex w-full items-center gap-2 px-2 py-1.5 text-sm italic text-text-muted"
                            >
                              {body}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
