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
// A folder — which in this product IS its index note — groups by what it is
// ABOUT, exactly like every other row: a person's context folder sits under
// People beside the flat person notes, because it is a person note that grew a
// folder. Only a folder that claims no subject stands as its own type — Index,
// or Subspace for a room's root — pinned to the top above the notes inside it,
// and painted in that type's console colour like every other band.
//
// Each group is painted in its type's configured colour — the same colour the
// directory grid and the profile rails use — because the grouping IS the
// information, and a column of identical grey rows makes you read it word by
// word. Clicking a row re-selects it in the browser — the tree reveals it and
// the content column swaps — so walking a chain of notes never leaves the page.

import { useMemo, useState, type CSSProperties } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@/features/shared/icons';
import { displayTypeOf } from '@/lib/notes/shared/indexNote';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { findAlias, getNodeTypeConfig } from '@/lib/types';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import type { SpaceAlias } from '@/lib/types';
import type { ContextItem } from '@/features/notes/lib/contextItems';
import { color } from '@visvine/tokens';

type Direction = 'out' | 'in' | 'both' | 'unresolved';

interface Connection {
  key: string;
  /** null for an unresolved link — nothing on the other end to select. */
  path: string | null;
  title: string;
  direction: Direction;
}

interface Group {
  /** Stable identity for collapse state: a type, or a type and its alias. */
  key: string;
  label: string;
  /** The alias's colour, else the type's — what the whole group is painted in. */
  color: string;
  /** A type a note wears by its SHAPE — Index, Subspace. Sorts above the rest. */
  container: boolean;
  connections: Connection[];
}

// Sort keys, not labels. These two stand for "this has no type" and "there's
// nothing on the other end", which are absences rather than types and are
// deliberately left uncoloured.
const UNTYPED = '__note__';
const UNRESOLVED = '__unresolved__';

/**
 * Absences read as grey; anything else is a real type with a real colour. The
 * token's hex rather than its custom property because every colour here is also
 * suffixed with an alpha pair for the hover tint, which a `var()` can't take.
 */
const NEUTRAL = color.hue.gray.default;

// Direction is carried by the row's tooltip alone: a glyph on every row turns
// the column into a wall of arrows to read past, and the name is what you scan
// for.
const DIRECTION_TITLE: Record<Direction, string> = {
  out: 'This note links here',
  in: 'Links to this note',
  both: 'Linked both ways',
  unresolved: 'Nothing on the other end',
};

interface ContextLinksPanelProps {
  /** The selected note, or null for the resting summary. */
  item: ContextItem | null;
  /** Every note in scope, index notes included — resolves backlinks and the
   *  other end's type. Indexes have to be in here: they're the notes that link
   *  down into a folder, so without them a note shows no incoming link from the
   *  folder it lives in, and the index group below stays permanently empty. */
  items: ContextItem[];
  /** Path → display title, owned by the browser so both panels agree. */
  titleFor: (path: string) => string;
  /**
   * The space alias held by the note's directory node, if any — an entity
   * note IS a node seen from the notes side, and the space's name for its
   * type ("Portfolio Company") is what the directory shows everywhere else.
   * Returns null for a plain note, which has no node behind it.
   */
  aliasOfPath: (path: string) => string | null;
  onSelectPath: (path: string) => void;
}

export default function ContextLinksPanel({
  item, items, titleFor, aliasOfPath, onSelectPath,
}: ContextLinksPanelProps) {
  const { currentSpace } = useSpace();
  const nodeTypes = currentSpace?.nodeTypes;
  const aliases = currentSpace?.aliases as SpaceAlias[] | undefined;
  // Expanded groups only — a type absent from the set is closed. The panel
  // opens as a stack of bands: a note's connections are a map first, a list
  // second, and every group open at once buries the map under its own rows.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const groups = useMemo<Group[]>(() => {
    if (!item) return [];
    const byPath = new Map(items.map((i) => [i.path, i]));
    const out = new Set(item.linkTargets);
    const incoming = items
      .filter((other) => other.path !== item.path && other.linkTargets.includes(item.path))
      .map((other) => other.path);

    const connections: Connection[] = [];
    for (const path of out) {
      if (path === item.path) continue;
      connections.push({
        key: path,
        path,
        title: titleFor(path),
        direction: incoming.includes(path) ? 'both' : 'out',
      });
    }
    for (const path of incoming) {
      if (out.has(path)) continue;
      connections.push({ key: path, path, title: titleFor(path), direction: 'in' });
    }
    // A link with nothing on the other end. Worth keeping: it's the note saying
    // something exists that the context hasn't captured yet.
    for (const name of item.unresolved) {
      connections.push({ key: `unresolved:${name}`, path: null, title: name, direction: 'unresolved' });
    }

    const grouped = new Map<string, Group>();
    for (const connection of connections) {
      // Group by the space's own type names (the console is the registry),
      // so `company` and `Space` land in one group under one spelling — and
      // then by the alias that names that type here, so a Space aliased
      // "Portfolio Company" gets its own band beside "Fund" rather than both
      // hiding under one "Space". An alias the console doesn't configure
      // for this type isn't one (events reuse the column for their public slug),
      // so those fall back to the plain type group. Only a note with no type at
      // all falls into the untyped bucket.
      const rawType = connection.path ? byPath.get(connection.path)?.type?.trim() || null : null;
      // What the note SHOWS: its declared type, else the one its shape gives it
      // — Index for a folder, Subspace for a room's root. Derived from the path
      // every time, because neither word is ever stored (indexNote.ts).
      const shownType = connection.path ? displayTypeOf(connection.path, rawType) : null;
      let key: string;
      let label: string;
      let color: string;
      if (connection.path === null) {
        key = UNRESOLVED;
        label = 'Unresolved';
        color = NEUTRAL;
      } else if (!shownType) {
        key = UNTYPED;
        label = 'Untyped';
        color = NEUTRAL;
      } else {
        const typeName = getNodeTypeConfig(shownType, nodeTypes).name;
        // A shape type holds no aliases (noAliases) and names no node, so only a
        // DECLARED type asks for one.
        const alias = rawType ? findAlias(aliases, aliasOfPath(connection.path), rawType) : undefined;
        // NUL joins the pair: it can't occur in a type or an alias name, so two
        // groups collide only when they really are the same type and alias.
        key = alias ? `${typeName}\u0000${alias.name}` : typeName;
        label = alias?.name ?? typeName;
        // A shape resolves through the space's vocabulary like any other type —
        // that is what `Index` is doing in DEFAULT_NODE_TYPES — so the band is
        // the console's colour, not a grey standing in for one.
        color = alias?.color ?? getTypeColor(typeName, nodeTypes);
      }
      const group = grouped.get(key);
      if (group) group.connections.push(connection);
      // A shape group — a folder or a room's root — is a container the rest sit
      // inside, so it is pinned above them however it is spelled here.
      else grouped.set(key, { key, label, color, container: !rawType && !!shownType, connections: [connection] });
    }

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        connections: group.connections.sort((a, b) => a.title.localeCompare(b.title)),
      }))
      // Indexes first (they're the containers everything else sits in), then
      // the biggest group — the note's dominant relationship — with unresolved
      // always last, since it's a to-do list, not a neighbourhood.
      .sort((a, b) => {
        if (a.container !== b.container) return a.container ? -1 : 1;
        if (a.key === UNRESOLVED) return 1;
        if (b.key === UNRESOLVED) return -1;
        return b.connections.length - a.connections.length || a.label.localeCompare(b.label);
      });
  }, [item, items, titleFor, nodeTypes, aliases, aliasOfPath]);

  if (!item) {
    return (
      <div className="flex h-full flex-col justify-center gap-2 px-4 text-sm text-fg-muted">
        <p className="text-fg-secondary">Select a context to see what it connects to.</p>
      </div>
    );
  }

  const total = groups.reduce((sum, group) => sum + group.connections.length, 0);

  return (
    // No heading of its own: the connections rail that mounts this panel is
    // already labelled, and a second label under it was the same word twice.
    <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
      {total === 0 ? (
        <p className="text-sm text-fg-muted">
          Nothing links here yet, and this note links nowhere.
        </p>
      ) : (
        // Spacing belongs to the OPEN list below a band, not between the bands:
        // collapsed groups are a stack of colour bars and any gap between them
        // reads as missing content. They sit flush, parted by a hairline of the
        // panel behind them so two same-coloured neighbours stay two bars.
        <div className="flex flex-col gap-px">
          {groups.map((group) => {
            const isCollapsed = !expanded.has(group.key);
            const Chevron = isCollapsed ? ChevronRightIcon : ChevronDownIcon;
            return (
              <section key={group.key}>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(group.key)) next.add(group.key);
                      return next;
                    })
                  }
                  // The header IS the colour: a full-width bar painted in the
                  // type's own colour EXACTLY as the console configured it, so
                  // the eye lands on the band before it reads a word and the
                  // band matches the type everywhere else in the app. The band
                  // is never darkened to carry its label — that changed the hue
                  // (the Index amber read as brown) and a type band whose job is
                  // to say "this is the Index colour" must be that colour. The
                  // label stays white on every band, light types included, so a
                  // stack of bands reads as one component rather than two.
                  style={{ backgroundColor: group.color }}
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
                    className="mb-3 mt-1 ml-2 flex flex-col gap-0.5 border-l-2 pl-1.5"
                    style={{ borderColor: `${group.color}40` }}
                  >
                    {group.connections.map((connection) => {
                      const body = <span className="min-w-0 flex-1 truncate">{connection.title}</span>;
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
                              className="group/row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-[var(--row-tint)] hover:text-fg"
                            >
                              {body}
                            </button>
                          ) : (
                            <div
                              title={DIRECTION_TITLE.unresolved}
                              className="group/row flex w-full items-center gap-2 px-2 py-1.5 text-sm italic text-fg-muted"
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
