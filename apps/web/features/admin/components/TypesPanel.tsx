'use client';

// Console → Types: every kind of thing this space records, and the aliases each
// kind can wear.
//
// Person is the one type whose aliases mean something beyond a label — they are
// the permission model (holders, ownership, context grants) — so they are handed
// out and pointed at content on Members, not here. This page still shows them,
// read-only, because a Person type you can't see the shape of isn't much of a
// description; it just doesn't edit them, so no name is ever edited twice.

import { useState, useEffect, type ReactNode } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { DEFAULT_NODE_TYPES, aliasesForType, mergeNodeTypeList } from '@/lib/types';
import type { SpaceAlias, Space, NodeTypeConfig } from '@/lib/types';
import { isNodeTypeEnabled, nodeTypeToolKey } from '@/lib/featureAccess';
import { fetchJsonBody } from '@/lib/fetchJson';
import { FEATURES } from '@/features/shared/lib/features';
import { Alert, Button, Chip, ColorPicker, ConfirmDialog, SearchInput, chipClass } from '@/components/ui';
import Select from '@/components/ui/Select';
import { patchInstall } from '@/features/tools/lib/client';
import { pageClaimantsFor } from '@/lib/tools/typePages';
import type { InstalledToolDto } from '@/lib/tools/installs';
import { useConsoleSave } from '@/features/admin/components/console/ConsoleSaveContext';
import { usePeopleSection } from '@/features/admin/components/people/PeopleDataContext';

// The type whose aliases are the permission model. Everything else's aliases are
// plain directory labels, stored on the space and edited in place.
const PERMISSION_TYPE = 'person';

// ─── Alias Chip ───────────────────────────────────────────────────────────────
// The same rounded square the alias wears on a directory card, a note header and
// a member row — this is where you pick its colour, so it has to be the shape
// you'll meet it in (components/ui/Chip.tsx).

function AliasChip({ alias, onColorChange, onRemove, disabled }: {
  alias: SpaceAlias;
  onColorChange: (c: string) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [localColor, setLocalColor] = useState(alias.color);

  const commit = (c: string) => { setLocalColor(c); setShowPicker(false); onColorChange(c); };

  return (
    <div className="relative inline-flex items-center gap-1">
      <Chip
        size="lg"
        color={localColor}
        disabled={disabled}
        title="Click to change colour"
        onClick={() => setShowPicker(p => !p)}
        onRemove={onRemove}
        removeLabel={`Remove "${alias.name}"`}
      >
        {alias.name}
      </Chip>
      {showPicker && (
        <div className="absolute left-0 top-9 z-40">
          <ColorPicker color={localColor} onChange={c => setLocalColor(c)} onClose={() => commit(localColor)} />
        </div>
      )}
    </div>
  );
}

// ─── Add Alias Row ────────────────────────────────────────────────────────────

function AddAliasRow({ nodeType, defaultColor, existing, onAdd, onCancel, disabled }: {
  nodeType: string;
  defaultColor: string;
  existing: SpaceAlias[];
  onAdd: (a: SpaceAlias) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(defaultColor);
  const [showPicker, setShowPicker] = useState(false);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existing.some(a => a.name.toLowerCase() === trimmed.toLowerCase() && a.nodeType === nodeType)) return;
    onAdd({ name: trimmed, color, nodeType });
    setName('');
    setColor(defaultColor);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPicker(p => !p)}
          className="w-7 h-7 rounded-lg border-2 border-border-default shrink-0 transition-transform hover:scale-110"
          style={{ background: color }}
          title="Pick colour"
        />
        {showPicker && (
          <ColorPicker color={color} onChange={setColor} onClose={() => setShowPicker(false)} />
        )}
      </div>
      <input
        autoFocus
        className="flex-1 px-3 py-1.5 rounded-lg border border-border-default bg-surface-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green transition-all"
        placeholder="Alias name"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowPicker(false); onCancel(); } }}
        maxLength={40}
      />
      <button
        onClick={handleAdd}
        disabled={!name.trim() || disabled}
        className="px-3 py-1.5 rounded-lg bg-brand-green text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
      >
        Add
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-3 text-sm transition-colors shrink-0"
      >
        Cancel
      </button>
    </div>
  );
}

// ─── Person aliases: read-only ────────────────────────────────────────────────

/**
 * What a Person can be, without being the place you change it. The chips are the
 * live permission snapshot rather than the space record, so they include the
 * built-in Admin and stay honest the moment an alias is renamed on Members. The
 * hover title carries the holder count; the row itself is just the vocabulary.
 */
function PersonAliases() {
  const { data } = usePeopleSection();

  if (data === null) return <p className="py-2 text-xs text-text-muted">Loading…</p>;

  const aliases = [...data.aliases].sort(
    (a, b) =>
      Number(b.system) - Number(a.system) ||
      Number(b.admin) - Number(a.admin) ||
      a.name.localeCompare(b.name),
  );

  return (
    <div className="flex flex-wrap gap-2">
      {aliases.map((alias) => (
        <Chip
          key={alias.name}
          size="lg"
          color={alias.color}
          title={`${alias.name} — ${alias.holders.length} ${alias.holders.length === 1 ? 'person' : 'people'}${alias.admin ? ', is admin of the space' : ''}`}
        >
          {alias.name}
        </Chip>
      ))}
    </div>
  );
}

// ─── Who draws a type's page ──────────────────────────────────────────────────

/**
 * The Tool that owns this type's page, on the row for the type itself.
 *
 * The profiles/spaces/events analogy, from the admin's side: a member-invented
 * type gets a real page the moment an installed Tool claims it, and this is the
 * one place that says which Tool that is. Built-in types never appear here —
 * Visvine owns those pages (lib/tools/typePages.ts).
 *
 * More than one claimant is impossible by construction (the install path refuses
 * a second page claim) and so is exactly the case worth being able to settle
 * from a screen: the picker hands the page to one Tool and releases it from the
 * rest, rather than leaving the answer to whichever install renders first.
 */
function TypePageOwner({ typeName, claimants, onChoose, saving }: {
  typeName: string;
  claimants: InstalledToolDto[];
  onChoose: (installId: string) => void;
  saving: boolean;
}) {
  const noun = `${typeName.toLowerCase()} notes`;

  if (claimants.length > 1) {
    return (
      <Select
        className="w-44 shrink-0"
        value={claimants[0].id}
        disabled={saving}
        title={`${claimants.length} tools claim this page — pick the one that draws it`}
        aria-label={`Which tool draws the page for ${noun}`}
        onChange={e => onChoose(e.target.value)}
      >
        {claimants.map(install => (
          <option key={install.id} value={install.id}>{install.title}</option>
        ))}
      </Select>
    );
  }

  const admin = claimants[0] ?? null;
  return (
    <span
      className="w-24 shrink-0 truncate text-right text-xs text-text-muted"
      title={admin ? `${admin.title} draws the page for ${noun}` : `No installed tool draws a page for ${noun}`}
    >
      {admin ? admin.title : '—'}
    </span>
  );
}

// ─── Type Section ─────────────────────────────────────────────────────────────

function TypeSection({ typeName, typeColor, toolLabel, pageOwner, aliases, allAliases, isPerson, noteScoped, previewChips, onAddAlias, onRemoveAlias, onUpdateAliasColor, onUpdateTypeColor, onDelete, saving }: {
  typeName: string;
  typeColor: string;
  /** The tool this type came in with — named on the row so switching a tool off
      never silently takes a type with it. Absent on member-made types. */
  toolLabel?: string;
  /** Which installed Tool draws this type's page. Member-made types only. */
  pageOwner?: ReactNode;
  aliases: SpaceAlias[];
  allAliases: SpaceAlias[];
  /** Person's aliases are the permission model, so it renders its own list. */
  isPerson?: boolean;
  /** A type a member invented: it labels context notes, so it has no aliases. */
  noteScoped?: boolean;
  previewChips: { name: string; color: string }[];
  onAddAlias: (a: SpaceAlias) => void;
  onRemoveAlias: (name: string, nodeType: string) => void;
  onUpdateAliasColor: (name: string, nodeType: string, color: string) => void;
  onUpdateTypeColor: (color: string) => void;
  /** Take this type out of the space's vocabulary. Member-made types only —
      a built-in is what the tools create entities under. */
  onDelete?: () => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const handleAdd = (alias: SpaceAlias) => {
    onAddAlias(alias);
    setAdding(false);
  };

  const toggleExpanded = () => {
    setExpanded(p => !p);
    setAdding(false);
    setShowColorPicker(false);
  };

  return (
    <div>
      {/* Header. This list IS the page, so the rows are sized like a heading
          each rather than like a settings line — a type is the biggest idea in
          the space, and the chips have to be readable at a glance. */}
      <div className="flex items-center gap-3.5 py-4">
        {/* Expand chevron */}
        <button
          type="button"
          onClick={toggleExpanded}
          className="w-6 h-6 flex items-center justify-center shrink-0 text-text-muted hover:text-text-primary transition-colors"
        >
          <svg
            className="w-4 h-4 transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Clickable color square — picker opens from here */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setShowColorPicker(p => !p); }}
            className="w-5 h-5 rounded transition-transform hover:scale-110"
            style={{ background: typeColor }}
            title="Change type colour"
          />
          {showColorPicker && (
            <div className="absolute left-0 top-7 z-50" onClick={e => e.stopPropagation()}>
              <ColorPicker
                color={typeColor}
                onChange={onUpdateTypeColor}
                onClose={() => setShowColorPicker(false)}
              />
            </div>
          )}
        </div>

        {/* Name — clicking expands */}
        <button
          type="button"
          onClick={toggleExpanded}
          className="font-semibold text-base text-text-primary flex-1 text-left"
        >
          {typeName}
        </button>

        {/* Alias preview */}
        {previewChips.length > 0 && (
          <button
            type="button"
            onClick={toggleExpanded}
            className="flex items-center gap-1.5 shrink-0"
          >
            {previewChips.slice(0, 3).map(a => (
              <Chip key={a.name} size="sm" color={a.color}>{a.name}</Chip>
            ))}
            {previewChips.length > 3 && (
              <span className="text-xs text-text-muted">+{previewChips.length - 3}</span>
            )}
          </button>
        )}

        {/* Which tool this type belongs to. Always last, so the tool names line
            up down the right edge however many aliases a row carries — it's
            provenance, not vocabulary, and must not read as an alias chip. */}
        {toolLabel && (
          <span
            className="w-24 shrink-0 text-right text-xs text-text-muted"
            title={`Comes with the ${toolLabel} tool`}
          >
            {toolLabel}
          </span>
        )}

        {/* Same column, same reason, for a member-made type: what draws its
            page. A tool type's page is Visvine's own, so the two never both
            appear on one row. */}
        {pageOwner}
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="space-y-3 pb-5 pl-[3.25rem]">
          {isPerson ? (
            <PersonAliases />
          ) : noteScoped ? (
            /* A type somebody named on the draft surface. Things made under it
               are context notes — Context and Raw, a coloured chip, no profile
               page — so there is nothing here to alias: an alias narrows a
               directory record, and a note isn't one. The colour square above
               is the whole of what this type has to configure. */
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm text-text-muted">
                Added from a note. Things of this type are context notes, so it carries no aliases —
                only its colour.
              </p>
              {onDelete && (
                <Button variant="danger" size="sm" disabled={saving} onClick={onDelete}>
                  Delete type
                </Button>
              )}
            </div>
          ) : (
            <>
              {aliases.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {aliases.map(alias => (
                    <AliasChip
                      key={`${alias.nodeType}:${alias.name}`}
                      alias={alias}
                      onColorChange={c => onUpdateAliasColor(alias.name, alias.nodeType, c)}
                      onRemove={() => onRemoveAlias(alias.name, alias.nodeType)}
                      disabled={saving}
                    />
                  ))}
                </div>
              )}

              {adding ? (
                <AddAliasRow
                  nodeType={typeName}
                  defaultColor={typeColor}
                  existing={allAliases}
                  onAdd={handleAdd}
                  onCancel={() => setAdding(false)}
                  disabled={saving}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className={chipClass({ tone: 'dashed', size: 'lg', className: 'gap-1.5 hover:bg-surface-3 hover:text-text-primary' })}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  Add alias
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// (The former "Link types" editor card was removed: links are derived from
// context-note mentions now, so relationship vocabulary isn't admin-curated —
// rendering falls back to DEFAULT_LINK_TYPES / getLinkTypeConfig.)

export default function TypesPanel() {
  const { currentSpace, refreshSpace } = useSpace();
  const { data, error: accessError, setError: setAccessError } = usePeopleSection();

  const [types, setTypes] = useState<NodeTypeConfig[]>(
    currentSpace?.nodeTypes ?? DEFAULT_NODE_TYPES
  );
  const [aliases, setAliases] = useState<SpaceAlias[]>(
    (currentSpace?.aliases as SpaceAlias[]) ?? []
  );
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NodeTypeConfig | null>(null);
  const { report } = useConsoleSave();

  useEffect(() => {
    if (currentSpace?.nodeTypes) setTypes(currentSpace.nodeTypes);
    if (currentSpace?.aliases) setAliases(currentSpace.aliases as SpaceAlias[]);
  }, [currentSpace]);

  /** Shared save shell: status reporting, error surface, refresh. */
  const save = async (run: () => Promise<unknown>) => {
    if (!currentSpace) return;
    setSaving(true);
    setError(null);
    report('saving');
    try {
      await run();
      await refreshSpace();
      report('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error saving');
      report('error');
    } finally {
      setSaving(false);
    }
  };

  // Types ride on the space record, which merges additively — this page's
  // snapshot can be minutes old and must not delete a type a member added since.
  const saveTypes = (nextTypes: NodeTypeConfig[]) => {
    if (!currentSpace) return;
    const space: Space = { ...currentSpace, nodeTypes: nextTypes };
    return save(() => fetchJsonBody('/api/data/communities', 'PUT', { space }));
  };

  // Aliases do NOT ride on that save. Creating one needs an id, removing one has
  // to clear the chips off every card wearing it, and for Person it has to carry
  // holders and grants — none of which a whole-record PUT can express. All of it
  // lives behind /api/aliases (lib/notes/typeAliases.ts), one alias at a time.
  const aliasAction = (body: Record<string, unknown>) =>
    save(() => fetchJsonBody('/api/aliases', 'POST', { spaceId: currentSpace?.id, ...body }));

  const handleAddAlias = (alias: SpaceAlias) =>
    aliasAction({ action: 'create', nodeType: alias.nodeType, name: alias.name, color: alias.color });
  const handleRemoveAlias = (name: string, nodeType: string) =>
    aliasAction({ action: 'delete', nodeType, name });
  const handleUpdateAliasColor = (name: string, nodeType: string, color: string) =>
    aliasAction({ action: 'update', nodeType, name, color });
  // A built-in the space never stored has nothing to map over, so recolour
  // by merging the edited entry in — mapping alone would silently no-op.
  const handleUpdateTypeColor = (type: NodeTypeConfig, color: string) =>
    saveTypes(mergeNodeTypeList(types, [{ ...type, color }]));

  // Deleting is the one edit the whole-record PUT can't express — it merges
  // additively, on purpose — so it has its own call. Notes already declaring
  // the type keep their `type:`; they just stop being coloured by it.
  const handleDeleteType = (type: NodeTypeConfig) =>
    save(async () => {
      await fetchJsonBody(
        `/api/communities/${currentSpace?.id}/node-types`,
        'DELETE',
        { name: type.name },
      );
      setDeleting(null);
    });

  // Hand a type's page to one install and take it off the others. Release
  // before claim, in that order: setTypeClaims refuses a `page` on a type
  // another install still holds, so a claim sent first would 409 and leave the
  // disagreement exactly as it was.
  const handleChoosePageOwner = (
    typeName: string,
    claimants: InstalledToolDto[],
    installId: string,
  ) => {
    if (!currentSpace) return;
    const spaceId = currentSpace.id;
    const type = typeName.trim().toLowerCase();
    return save(async () => {
      for (const other of claimants) {
        if (other.id === installId) continue;
        await patchInstall(spaceId, other.id, { typeClaims: { [type]: 'tab' } });
      }
      await patchInstall(spaceId, installId, { typeClaims: { [type]: 'page' } });
    });
  };

  if (!currentSpace) {
    return <div className="p-6 text-sm text-text-muted">Select a space to manage types.</div>;
  }

  // Every type this space has: the built-ins plus the ones members named on the
  // draft-context surface. The stored entry wins where both exist — that's the
  // colour this page saved. Without the union a member's type would be
  // invisible here, which is the one place its colour can be changed.
  const byLower = new Map<string, NodeTypeConfig>();
  for (const t of DEFAULT_NODE_TYPES) byLower.set(t.name.toLowerCase(), t);
  for (const t of types) byLower.set(t.name.toLowerCase(), t);
  const listedTypes = Array.from(byLower.values())
    .filter(t => isNodeTypeEnabled(currentSpace.featureConfig ?? null, t.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Two different things share this page. A tool type arrived with a tool and
  // disappears with it; a custom type is one a member named on a draft and
  // belongs to nobody but the space. Telling them apart is the difference
  // between "why can't I delete Channel" and "why is Playbook in this list".
  const toolLabels = new Map(FEATURES.map(f => [f.key, f.label]));
  const toolTypes: { type: NodeTypeConfig; toolLabel: string }[] = [];
  const customTypes: NodeTypeConfig[] = [];
  // Search reaches a type's aliases as well as its name: an alias is the word a
  // member actually has in mind ("Founder"), and the type it hangs off
  // ("Person") is what they're looking for. Person's aliases live on the
  // permission snapshot, so they're matched from there.
  const term = query.trim().toLowerCase();
  const matches = (type: NodeTypeConfig) => {
    if (!term) return true;
    if (type.name.toLowerCase().includes(term)) return true;
    const named = type.name.toLowerCase() === PERMISSION_TYPE
      ? (data?.aliases ?? [])
      : aliasesForType(aliases, type.name);
    return named.some(a => a.name.toLowerCase().includes(term));
  };
  for (const type of listedTypes) {
    if (!matches(type)) continue;
    const key = nodeTypeToolKey(type.name);
    const label = key ? toolLabels.get(key) : undefined;
    if (label) toolTypes.push({ type, toolLabel: label });
    else customTypes.push(type);
  }

  const renderType = (liveType: NodeTypeConfig, toolLabel?: string) => {
    const isPerson = liveType.name.toLowerCase() === PERMISSION_TYPE;
    const typeAliases = aliasesForType(aliases, liveType.name);
    // Only a member-made type can have a Tool-owned page; pageClaimantsFor
    // answers empty for everything else, so the column stays off those rows
    // rather than promising a '—' that could never become a name.
    const noteScoped = liveType.scope === 'note';
    const claimants = noteScoped
      ? pageClaimantsFor(currentSpace.installedTools, liveType.name)
      : [];
    return (
      <TypeSection
        key={liveType.name}
        typeName={liveType.name}
        typeColor={liveType.color}
        toolLabel={toolLabel}
        pageOwner={
          noteScoped ? (
            <TypePageOwner
              typeName={liveType.name}
              claimants={claimants}
              saving={saving}
              onChoose={installId => handleChoosePageOwner(liveType.name, claimants, installId)}
            />
          ) : undefined
        }
        noteScoped={noteScoped}
        aliases={typeAliases}
        allAliases={aliases}
        isPerson={isPerson}
        // Person's preview comes from the live permission snapshot, which
        // already grafts in the built-in Admin; every other type's from the
        // space record it saves to.
        previewChips={isPerson ? (data?.aliases ?? []) : typeAliases}
        onAddAlias={handleAddAlias}
        onRemoveAlias={handleRemoveAlias}
        onUpdateAliasColor={handleUpdateAliasColor}
        onUpdateTypeColor={color => handleUpdateTypeColor(liveType, color)}
        onDelete={noteScoped ? () => setDeleting(liveType) : undefined}
        saving={saving}
      />
    );
  };

  return (
    <div className="space-y-6">
      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {accessError && <Alert variant="error" onDismiss={() => setAccessError(null)}>{accessError}</Alert>}

      {/* The tab bar above already says "Types", so each list starts straight
          away under its own heading. A type whose tool is switched off isn't
          offered at all — no point curating aliases for something the space
          can't create.

          Alphabetical within each group: the registry order in
          DEFAULT_NODE_TYPES groups types by what they are (people, then places,
          then containers) and the directory and graph still read it that way. A
          list you scan to find one type wants names in the order you'd look
          them up. */}
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search types and aliases…"
      />

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Tool types
        </h3>
        {toolTypes.length > 0 ? (
          <div className="mt-1 divide-y divide-border-subtle">
            {toolTypes.map(({ type, toolLabel }) => renderType(type, toolLabel))}
          </div>
        ) : (
          <p className="py-4 text-sm text-text-muted">No matches.</p>
        )}
      </section>

      {/* Member-made types. Rendered even when empty — an empty list is the
          answer to "where do the types I name on a draft show up?". */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Custom types
        </h3>
        {customTypes.length > 0 ? (
          <div className="mt-1 divide-y divide-border-subtle">
            {customTypes.map(type => renderType(type))}
          </div>
        ) : (
          <p className="py-4 text-sm text-text-muted">{term ? 'No matches.' : 'None yet.'}</p>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ''}"?`}
        body={
          <>
            It stops being offered when somebody types a type, and notes already
            marked <code>{deleting?.name}</code> lose its colour and chip. Their
            frontmatter is left alone, so naming the type again brings them back.
          </>
        }
        confirmLabel="Delete type"
        destructive
        onConfirm={async () => { if (deleting) await handleDeleteType(deleting); }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
